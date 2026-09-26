const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function hashPassword(password) {
  return await bcrypt.hash(password, 12);
}

async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  let pwd = '';
  for (let i = 0; i < 14; i++) {
    // A CSPRNG: these become real login passwords (first admin, admin-issued
    // client passwords), and Math.random is predictable.
    pwd += chars.charAt(crypto.randomInt(chars.length));
  }
  return pwd;
}

module.exports = { hashPassword, comparePassword, generateTempPassword };
