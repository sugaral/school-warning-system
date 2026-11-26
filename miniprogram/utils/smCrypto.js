const sm2 = require('./sm2');

const CIPHER_MODE = 1; // C1C3C2 与 Snowy 后端 CommonCryptogramUtil 一致
const PUBLIC_KEY =
  '04298364ec840088475eae92a591e01284d1abefcda348b47eb324bb521bb03b0b2a5bc393f6b71dabb8f15c99a0050818b56b23f31743b93df9cf8948f15ddb54';

function doSm2Encrypt(plainText) {
  if (!plainText) return '';
  return sm2.doEncrypt(String(plainText), PUBLIC_KEY, CIPHER_MODE);
}

module.exports = {
  doSm2Encrypt,
  PUBLIC_KEY,
  CIPHER_MODE,
};
