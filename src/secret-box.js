const { EncryptCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const { kmsClient } = require('./aws-clients');
const crypto = require('node:crypto');

const kmsKeyId = process.env.INTEGRATION_KMS_KEY_ARN || process.env.SECURE_KMS_KEY_ARN || '';
const localKeyB64 = process.env.INTEGRATION_ENCRYPTION_KEY || '';

const buildLocalKey = () => {
  if (!localKeyB64) return null;
  const buffer = Buffer.from(localKeyB64, 'base64');
  if (buffer.length !== 32) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte string for AES-256-GCM.'
    );
  }
  return buffer;
};

const localKey = buildLocalKey();

if (!kmsKeyId && !localKey) {
  throw new Error(
    'INTEGRATION_KMS_KEY_ARN or INTEGRATION_ENCRYPTION_KEY must be set to store integration secrets.'
  );
}

const encryptLocal = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', localKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `loc:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
};

const decryptLocal = (payload) => {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid local ciphertext payload');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', localKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
};

const encryptWithKms = async (plaintext) => {
  if (!kmsKeyId) {
    throw new Error('INTEGRATION_KMS_KEY_ARN or INTEGRATION_ENCRYPTION_KEY must be set to store integration secrets.');
  }
  const response = await kmsClient.send(
    new EncryptCommand({
      KeyId: kmsKeyId,
      Plaintext: Buffer.from(plaintext, 'utf8'),
    })
  );
  return `kms:${response.CiphertextBlob.toString('base64')}`;
};

const decryptWithKms = async (payload) => {
  const blob = Buffer.from(payload, 'base64');
  const response = await kmsClient.send(
    new DecryptCommand({
      CiphertextBlob: blob,
    })
  );
  return response.Plaintext.toString('utf8');
};

const encryptSecret = async (plaintext) => {
  if (!plaintext) return null;
  if (localKey) {
    return encryptLocal(plaintext);
  }
  return encryptWithKms(plaintext);
};

const decryptSecret = async (ciphertext) => {
  if (!ciphertext) return null;
  if (ciphertext.startsWith('loc:')) {
    if (!localKey) {
      throw new Error('INTEGRATION_ENCRYPTION_KEY must be set to decrypt local ciphertext.');
    }
    return decryptLocal(ciphertext.slice(4));
  }
  if (ciphertext.startsWith('kms:')) {
    return decryptWithKms(ciphertext.slice(4));
  }
  // Backwards compatibility (should not happen): assume plaintext
  return ciphertext;
};

module.exports = {
  encryptSecret,
  decryptSecret,
};
