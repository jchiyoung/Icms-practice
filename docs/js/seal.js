/**
 * Lightweight obfuscation so answer keys and explanations are not plain
 * text in the page source. This is not encryption: the page must be able
 * to grade itself. A student who reads the script can still recover a key.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ICMS = Object.assign(root.ICMS || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SECRET = "icms-practice-seal-v1";

  function keyBytes(id) {
    const material = SECRET + "|" + String(id);
    const out = new Uint8Array(material.length);
    for (let i = 0; i < material.length; i++) out[i] = material.charCodeAt(i) & 255;
    return out;
  }

  function xorBytes(bytes, id) {
    const key = keyBytes(id);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
    return out;
  }

  function toBase64(bytes) {
    let binary = "";
    const size = 0x8000;
    for (let i = 0; i < bytes.length; i += size) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function fnv(bytes) {
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function seal(obj, id) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    const packed = JSON.stringify({ mac: fnv(bytes), json });
    return toBase64(xorBytes(new TextEncoder().encode(packed), id));
  }

  function unseal(payload, id) {
    const packed = JSON.parse(new TextDecoder().decode(xorBytes(fromBase64(payload), id)));
    const bytes = new TextEncoder().encode(packed.json);
    if (!packed.mac || fnv(bytes) !== packed.mac) throw new Error("bad seal");
    return JSON.parse(packed.json);
  }

  return { seal, unseal };
});
