const crypto = require('crypto');

if (!globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues: function(arr) {
      if (arr instanceof Uint32Array || arr instanceof Int32Array) {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = crypto.randomBytes(4).readUInt32BE(0);
        }
      }
      return arr;
    }
  };
}