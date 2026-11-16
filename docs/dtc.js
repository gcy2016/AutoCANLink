// 故障码（DTC）帧的编码 / 解码 / 中文含义查询。
// 演示用的固定格式（编的，跟任何车型都无关；以后换真实格式只改这个文件）：
//   CAN ID 默认 0x6AA（可在录制页增删，只认编号、不分标准 / 扩展帧），8 字节
//   byte0     故障码个数（0x01 = 本帧带 1 个）
//   byte1~3   第 1 个故障码的 3 字节 UDS 编码，高字节在前
//   byte4~6   第 2 个故障码（有的话；本演示只用 1 个）
//   byte4~7   空着的字节填 0
//   演示码 C1234 的 3 字节编码是 52 34 00，整帧就是 01 52 34 00 00 00 00 00
//
// 3 字节 UDS 编码 → 故障码字符串（ISO 14229 通用规则）：
//   byte0 bit7~6：类别 00=P 01=C 10=B 11=U
//   byte0 bit5~4：第 1 位；byte0 bit3~0：第 2 位
//   byte1 bit7~4：第 3 位；byte1 bit3~0：第 4 位
//   byte2：故障类型字节（FTB），不参与显示
//   例：52 34 00 → C1234
const DTC = (() => {
  const ID = 0x6AA;                        // 默认故障码帧的 CAN ID
  const MAX_ID = 0x1FFFFFFF;               // CAN ID 上限（29 位，扩展帧最大编号）
  const DEFAULT_IDS = [ID];                // 默认监听列表（只存编号）
  const LETTER = ['P', 'C', 'B', 'U'];

  // ---- 监听 ID 列表：只认编号，不分标准 / 扩展帧 ----
  const idText = id => '0x' + id.toString(16).toUpperCase().padStart(3, '0');
  const idLabel = id => idText(id);

  // 用户输入 → 数字；出错时抛中文提示。
  function parseId(text) {
    let t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('请输入CAN ID，例如 0x6AA');
    if (/^0x/i.test(t)) t = t.slice(2).trim();
    if (!t) throw new Error('0x 后面还要有十六进制数字，例如 0x6AA');
    if (!/^[0-9a-f]+$/i.test(t)) throw new Error('CAN ID 只能是十六进制数字（0-9、A-F），例如 0x6AA');
    t = t.replace(/^0+(?=.)/, '');          // 去掉前导 0，避免超长输入绕过范围检查
    if (t.length > 8 || parseInt(t, 16) > MAX_ID) {
      throw new Error(`CAN ID 超出范围（0x000–0x${MAX_ID.toString(16).toUpperCase()}）`);
    }
    return parseInt(t, 16);
  }

  const hasId = (list, id) => Array.isArray(list) && list.some(x => x === id);

  // 加一个 ID（text 为用户输入），返回新数组；重复 / 非法时抛错，原数组不动。
  function addId(list, text) {
    const id = parseId(text);
    if (hasId(list, id)) throw new Error(`${idText(id)} 已在监听列表里，未重复添加`);
    return (Array.isArray(list) ? list : []).concat([id]);
  }

  // 收到的帧编号是否命中列表（不看标准 / 扩展类型）。
  function matchId(list, id) {
    return hasId(list, id);
  }

  // 读本机保存的列表时做校验：兼容旧格式（{id, ext} 对象，只取编号），
  // 丢掉格式不对 / 超范围 / 重复的项，返回纯数字数组。
  function normalizeIds(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const x of raw) {
      const id = typeof x === 'number' ? x : (x && typeof x === 'object' ? x.id : null);
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > MAX_ID) continue;
      if (hasId(out, id)) continue;
      out.push(id);
    }
    return out;
  }

  // 3 字节 UDS 编码 → 'C1234'
  function format(bytes) {
    const b0 = bytes[0] & 0xFF, b1 = bytes[1] & 0xFF;
    return LETTER[b0 >> 6] +
      ((b0 >> 4) & 0x3).toString(16).toUpperCase() +
      (b0 & 0xF).toString(16).toUpperCase() +
      ((b1 >> 4) & 0xF).toString(16).toUpperCase() +
      (b1 & 0xF).toString(16).toUpperCase();
  }

  // 故障码字符串（'C1234'）→ 3 字节 UDS 编码（format 的反向）
  function parse(code) {
    const m = /^([PCBU])([0-3])([0-9A-F])([0-9A-F])([0-9A-F])$/.exec(String(code).trim().toUpperCase());
    if (!m) throw new Error('故障码格式不对：' + code);
    return [
      (LETTER.indexOf(m[1]) << 6) | (+m[2] << 4) | parseInt(m[3], 16),
      (parseInt(m[4], 16) << 4) | parseInt(m[5], 16),
      0x00,                                        // 故障类型字节，演示固定填 0
    ];
  }

  // 编码：codes 是故障码字符串（如 'C1234'）或 3 字节 UDS 编码（数组），返回 8 字节帧数据
  function encode(codes) {
    const out = new Uint8Array(8);
    const list = (codes || []).slice(0, 2)         // 8 字节最多放 2 个（1 + 3×2）
      .map(c => typeof c === 'string' ? parse(c) : Array.from(c).slice(0, 3));
    out[0] = list.length;
    list.forEach((b, i) => out.set(b, 1 + i * 3));
    return out;
  }

  // 解码：8 字节帧数据 → [{ bytes: [3 字节], code: 'C1234' }]；帧不够长时只解出完整的码
  function decode(data) {
    if (!data || !data.length) return [];
    const n = data[0], out = [];
    for (let i = 0; i < n && i < 2; i++) {
      const o = 1 + i * 3;
      if (o + 2 >= data.length) break;
      const bytes = [data[o], data[o + 1], data[o + 2]];
      out.push({ bytes, code: format(bytes) });
    }
    return out;
  }

  // 内置示例含义表：只放演示码，内容是占位，不代表任何真实车型 / 真实故障。
  // 以后接真实含义表只改这个函数：查到返回中文含义，查不到返回 null（只报码，不报错）。
  const MEANINGS = { C1234: '演示占位含义（示例表，无实际意义）' };
  function meaning(code) {
    return Object.prototype.hasOwnProperty.call(MEANINGS, code) ? MEANINGS[code] : null;
  }

  return {
    ID, MAX_ID, DEFAULT_IDS,
    idText, idLabel, parseId, addId, matchId, normalizeIds,
    format, parse, encode, decode, meaning,
  };
})();
if (typeof module !== 'undefined') module.exports = DTC;
