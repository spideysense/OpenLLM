// Check ZIP expansion before handing Office documents to their parsers. Both
// declared and actually inflated sizes are bounded; ZIP headers are untrusted.
const MAX_EXPANDED = 32 * 1024 * 1024;
async function check(buffer) {
  return new Promise((resolve, reject) => {
    require('yauzl').fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(error);
        let expanded = 0,
          actual = 0,
          entries = 0,
          failed = false;
        const fail = (error) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(error);
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (!failed) resolve();
        });
        zip.on('entry', (entry) => {
          expanded += entry.uncompressedSize;
          if (
            ++entries > 2048 ||
            expanded > MAX_EXPANDED ||
            entry.uncompressedSize > 16 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1
          )
            return fail(
              new Error('Document archive exceeds safe extraction limits or is encrypted')
            );
          zip.openReadStream(entry, (error, stream) => {
            if (error) return fail(error);
            stream.on('error', fail);
            stream.on('data', (chunk) => {
              actual += chunk.length;
              if (actual > MAX_EXPANDED) {
                stream.destroy();
                fail(new Error('Document archive expands beyond 32 MB'));
              }
            });
            stream.on('end', () => {
              if (!failed) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      }
    );
  });
}
module.exports = { check };
