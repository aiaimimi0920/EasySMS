// Pure TypeScript RFC 1321 MD5 implementation for Web/Cloudflare Workers compatibility.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = Array.from({ length: 64 }, (_, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
);

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function toHexLittleEndian(word: number): string {
  let out = "";
  for (let index = 0; index < 4; index += 1) {
    out += ((word >>> (index * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >>> 6) + 1) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes, 0);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let step = 0; step < 64; step += 1) {
      let f = 0;
      let g = 0;
      if (step < 16) {
        f = (b & c) | (~b & d);
        g = step;
      } else if (step < 32) {
        f = (d & b) | (~d & c);
        g = (5 * step + 1) % 16;
      } else if (step < 48) {
        f = b ^ c ^ d;
        g = (3 * step + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * step) % 16;
      }

      const sum = (a + f + K[step] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, S[step])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return (
    toHexLittleEndian(a0)
    + toHexLittleEndian(b0)
    + toHexLittleEndian(c0)
    + toHexLittleEndian(d0)
  );
}
