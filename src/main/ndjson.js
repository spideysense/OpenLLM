class NDJSON {
  constructor() {
    this.decoder = new TextDecoder();
    this.buffer = '';
  }
  push(bytes, final = false) {
    this.buffer += this.decoder.decode(bytes, { stream: !final });
    const lines = this.buffer.split('\n');
    this.buffer = final ? '' : lines.pop();
    return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
}
async function* records(body) {
  const parser = new NDJSON();
  for await (const bytes of body) yield* parser.push(bytes);
  yield* parser.push(undefined, true);
}
module.exports = { NDJSON, records };
