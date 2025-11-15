const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const attrs = [{ name: 'commonName', value: '192.168.29.166' }];
const options = {
  days: 365,
  keySize: 2048,
  extensions: [{
    name: 'subjectAltName',
    altNames: [
      { type: 2, value: '192.168.29.166' }, // IP address
      { type: 2, value: 'localhost' }      // localhost
    ]
  }]
};
const pems = selfsigned.generate(attrs, options);

fs.writeFileSync(path.join(__dirname, 'key.pem'), pems.private);
fs.writeFileSync(path.join(__dirname, 'cert.pem'), pems.cert);

console.log('SSL certificates generated with selfsigned');
