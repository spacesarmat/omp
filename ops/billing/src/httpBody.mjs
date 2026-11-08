function headerValue(res, name) {
  if (!res || !res.headers) return '';
  if (typeof res.headers.get === 'function') return String(res.headers.get(name) || '');
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(res.headers[key] || '') : '';
}

function tooLarge(code) {
  return Object.assign(new Error(code), { code });
}

export async function readCappedBody(res, maxBytes, code = 'too_large') {
  const declared = Number(headerValue(res, 'content-length'));
  if (declared > maxBytes) {
    if (res.body && typeof res.body.cancel === 'function') {
      await res.body.cancel().catch(() => undefined);
    } else if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      try {
        await reader.cancel().catch(() => undefined);
      } finally {
        reader.releaseLock();
      }
    }
    throw tooLarge(code);
  }
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        if (!chunk) continue;
        size += chunk.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw tooLarge(code);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const out = Buffer.allocUnsafe(size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
  let buf;
  if (typeof res.arrayBuffer === 'function') buf = Buffer.from(await res.arrayBuffer());
  else buf = Buffer.from(await res.text(), 'utf8');
  if (buf.byteLength > maxBytes) throw tooLarge(code);
  return buf;
}
