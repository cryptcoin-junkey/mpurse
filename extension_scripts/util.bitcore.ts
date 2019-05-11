import * as Mnemonic from './external/mnemonic.js';
import * as Bip39 from 'bip39';
import * as BitCore from 'bitcore-lib';
import * as BitCoreMessage from 'bitcore-message';
import * as CryptoJS from 'crypto-js';
import { MpchainUtil } from './util.mpchain';

export class BitcoreUtil {

  NETWORK;
  basePath = 'm/0\'/0/';
  // 'm/44\'/22\'/0\'/0/'

  constructor() {
    BitCoreMessage.MAGIC_BYTES = BitCore.deps.Buffer('Monacoin Signed Message:\n');

    const mainnet = {
      hashGenesisBlock: 'ff9f1c0116d19de7c9963845e129f9ed1bfc0b376eb54fd7afa42e0d418c8bb6',
      port: 9401,
      portRpc: 9402,
      protocol: { magic: 3686187259 },
      seedsDns: [ 'dnsseed.monacoin.org' ],
      versions:
      { bip32: { private: 76066276, public: 76067358 },
        bip44: 22,
        private: 176,
        private_old: 178,
        public: 50,
        scripthash: 55,
        scripthash2: 5 },
      name: 'livenet',
      unit: 'MONA',
      testnet: false,
      alias: 'mainnet',
      pubkeyhash: 50,
      privatekey: 176,
      privatekey_old: 178,
      scripthash: 55,
      xpubkey: 76067358,
      xprivkey: 76066276,
      networkMagic: 4223710939,
      dnsSeeds: [ 'dnsseed.monacoin.org' ]
    };

    const testnet = {
      hashGenesisBlock: 'a2b106ceba3be0c6d097b2a6a6aacf9d638ba8258ae478158f449c321061e0b2',
      port: 19403,
      portRpc: 19402,
      protocol: { magic: 4056470269 },
      seedsDns: [ 'testnet-dnsseed.monacoin.org' ],
      versions:
      { bip32: { private: 70615956, public: 70617039 },
        bip44: 1,
        private: 239,
        public: 111,
        scripthash: 117,
        scripthash2: 196 },
      name: 'testnet',
      unit: 'MONA',
      testnet: true,
      alias: 'testnet',
      pubkeyhash: 111,
      privatekey: 239,
      scripthash: 117,
      xpubkey: 70617039,
      xprivkey: 70615956,
      networkMagic: 4258449649,
      dnsSeeds: [ 'testnet-dnsseed.monacoin.org' ]
    };

    BitCore.Networks.remove(BitCore.Networks.testnet);
    BitCore.Networks.mainnet = BitCore.Networks.add(mainnet);
    BitCore.Networks.testnet = BitCore.Networks.add(testnet);
    BitCore.Networks.livenet = BitCore.Networks.mainnet;

    this.NETWORK = BitCore.Networks.livenet;
  }

  generateRandomMnemonic(): string {
    const mnemonic = new Mnemonic(128).toWords();
    return mnemonic.join(' ');
  }

  // generateRandomBip39Mnemonic(): string {
  //   return Bip39.generateMnemonic();
  // }

  getHDPrivateKey(passphrase: string): BitCore.PrivateKey {
    const words = passphrase.toLowerCase().split(' ');
    const seed = new Mnemonic(words).toHex();
    return BitCore.HDPrivateKey.fromSeed(seed, this.NETWORK);
  }

  getPrivateKey(hDPrivateKey: BitCore.PrivateKey, index: number): BitCore.PrivateKey {
    return hDPrivateKey.derive(this.basePath + index).privateKey;
  }

  getPrivateKeyFromHex(hex: string): BitCore.PrivateKey {
    return new BitCore.PrivateKey(hex, this.NETWORK);
  }

  getPrivateKeyFromWIF(wif: string): BitCore.PrivateKey {
    return BitCore.PrivateKey.fromWIF(wif, this.NETWORK);
  }

  getAddress(privateKey: BitCore.PrivateKey): string {
    return privateKey.toAddress(this.NETWORK).toString();
  }

  hex2WIF(hex: string): string {
    return new BitCore.PrivateKey(hex, this.NETWORK).toWIF();
  }

  decodeBase58(str: string): Uint8Array {
    return BitCore.encoding.Base58.decode(str);
  }

  signTransaction(unsignedHex: string, hex: string): Promise<string> {
    return this.rebuildScriptPubKey(unsignedHex)
      .then(tx => tx.sign(this.getPrivateKeyFromHex(hex)).toString());
  }

  signMessage(message: string, hex: string): string {
    const base64 = BitCoreMessage(message).sign(this.getPrivateKeyFromHex(hex));
    return BitCore.deps.Buffer(base64, 'base64').toString('base64');
  }

  verify(address: string, message: string, signature: string): boolean {
    return BitCoreMessage(message).verify(address, signature);
  }

  private async rebuildScriptPubKey(unsignedHex: string): Promise<any> {
    const tx = BitCore.Transaction(unsignedHex);
    for (let i = 0; i < tx.inputs.length; i++) {
      const script = BitCore.Script(tx.inputs[i]._scriptBuffer.toString('hex'));
      let inputObj: any;
      let multiSigInfo: any;

      switch (script.classify()) {
        case BitCore.Script.types.PUBKEY_OUT:
          inputObj = tx.inputs[i].toObject();
          inputObj.output = BitCore.Transaction.Output({
            script: tx.inputs[i]._scriptBuffer.toString('hex'),
            satoshis: 0
          });
          tx.inputs[i] = new BitCore.Transaction.Input.PublicKey(inputObj);
          break;

        case BitCore.Script.types.PUBKEYHASH_OUT:
          inputObj = tx.inputs[i].toObject();
          inputObj.output = BitCore.Transaction.Output({
            script: tx.inputs[i]._scriptBuffer.toString('hex'),
            satoshis: 0
          });
          tx.inputs[i] = new BitCore.Transaction.Input.PublicKeyHash(inputObj);
          break;

        case BitCore.Script.types.MULTISIG_IN:
          inputObj = tx.inputs[i].toObject();
          tx.inputs[i] = MpchainUtil.getScriptPubKey(inputObj.prevTxId, inputObj.outputIndex)
            .then(result => {
                inputObj.output = BitCore.Transaction.Output({
                  script: result['scriptPubKey']['hex'],
                  satoshis: BitCore.Unit.fromBTC(result['value']).toSatoshis()
                });
                multiSigInfo = this.extractMultiSigInfoFromScript(inputObj.output.script);
                inputObj.signatures = BitCore.Transaction.Input.MultiSig.normalizeSignatures(
                  tx,
                  new BitCore.Transaction.Input.MultiSig(inputObj, multiSigInfo.publicKeys, multiSigInfo.threshold),
                  i,
                  script.chunks.slice(1, script.chunks.length).map(function(s) { return s.buf; }),
                  multiSigInfo.publicKeys
                );
                return new BitCore.Transaction.Input.MultiSig(inputObj, multiSigInfo.publicKeys, multiSigInfo.threshold);
            });
          break;
        case BitCore.Script.types.MULTISIG_OUT:
          inputObj = tx.inputs[i].toObject();
          inputObj.output = BitCore.Transaction.Output({
            script: tx.inputs[i]._scriptBuffer.toString('hex'),
            satoshis: 0
          });
          multiSigInfo = this.extractMultiSigInfoFromScript(inputObj.output.script);
          tx.inputs[i] = new BitCore.Transaction.Input.MultiSig(inputObj, multiSigInfo.publicKeys, multiSigInfo.threshold);
          break;
        case BitCore.Script.types.SCRIPTHASH_OUT:
        case BitCore.Script.types.DATA_OUT:
        case BitCore.Script.types.PUBKEY_IN:
        case BitCore.Script.types.PUBKEYHASH_IN:
        case BitCore.Script.types.SCRIPTHASH_IN:
          break;
        default:
          throw new Error('Unknown scriptPubKey [' + script.classify() + '](' + script.toASM() + ')');
      }
    }
    tx.inputs = await Promise.all(tx.inputs);
    return tx;
  }

  private extractMultiSigInfoFromScript(script: any): any {
    const nKeysCount = BitCore.Opcode(script.chunks[script.chunks.length - 2].opcodenum).toNumber() - BitCore.Opcode.map.OP_1 + 1;
    const threshold =
      BitCore.Opcode(script.chunks[script.chunks.length - nKeysCount - 2 - 1].opcodenum).toNumber() - BitCore.Opcode.map.OP_1 + 1;
    return {
      publicKeys: script.chunks.slice(script.chunks.length - 2 - nKeysCount, script.chunks.length - 2).map(function(pubKey) {
        return BitCore.PublicKey(pubKey.buf);
      }),
      threshold: threshold
    };
  }

  // encrypt(message: string, password: string): string {
  //   return CryptoJS.AES.encrypt(message, password).toString();
  // }

  // decrypt(cryptedMessage: string, password: string): string {
  //   return CryptoJS.enc.Utf8.stringify(CryptoJS.AES.decrypt(cryptedMessage, password));
  // }

  createCheckSum(password: string): string {
    return CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
  }
}
