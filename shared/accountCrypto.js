// shared/accountCrypto.js — [ACCOUNT] 账号传输加密（浏览器 + Node 同款算法）。
//
// 设计：账号 JSON **明文存于服务器**；**传输**时加密。密钥 = 各用户 QQ 号：
//   keyBytes = SHA-256( `${salt}:${qq}` )  → AES-256-GCM 32 字节密钥
//   salt     = 服务器自建公钥指纹（sha256(spki) 十六进制），随 account.data 下发（公开）
// 载荷布局两端一致： base64( iv(12) || ciphertext || tag(16) )
//   * 服务端：node:crypto（同步）
//   * 浏览器：优先 WebCrypto；**非安全上下文（http+IP）没有 crypto.subtle → 用纯 JS 回退**（与 Node 互通）。
//
// ⚠ 重要：游戏是 http://<IP> 访问（非 secure context），Chrome/Firefox 下 `crypto.subtle` 不可用；
//    若只依赖 WebCrypto 会导致客户端解不开云端存档 → 多端不同步。故必须有纯 JS 回退。

export const ACCOUNT_CRYPTO = 'aes-256-gcm-sha256qq-v1';

const te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
const enc = (s) => (te ? te.encode(s) : Buffer.from(s, 'utf8'));
const dec = (u8) => (td ? td.decode(u8) : Buffer.from(u8).toString('utf8'));

/** 密钥材料字符串（两端一致）。 */
export function keyMaterial(qq, saltHex) { return `${saltHex}:${qq}`; }

// ---- 纯 JS（无 WebCrypto 时用；与 node:crypto 互通，已验证 NIST 向量）-------------------------------------------------------------------------------
const SBOX=new Uint8Array([99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22]);
const RCON=[0,1,2,4,8,16,32,64,128,27,54];
const xt=(a)=>((a<<1)^((a&0x80)?0x1b:0))&0xff;
const Te0=new Uint32Array(256),Te1=new Uint32Array(256),Te2=new Uint32Array(256),Te3=new Uint32Array(256);
for(let i=0;i<256;i++){const s=SBOX[i],s2=xt(s),s3=s2^s;Te0[i]=((s2<<24)|(s<<16)|(s<<8)|s3)>>>0;Te1[i]=((s3<<24)|(s2<<16)|(s<<8)|s)>>>0;Te2[i]=((s<<24)|(s3<<16)|(s2<<8)|s)>>>0;Te3[i]=((s<<24)|(s<<16)|(s3<<8)|s2)>>>0;}
function keyExp(k){const Nk=8,Nr=14,w=new Uint32Array(4*(Nr+1));for(let i=0;i<Nk;i++)w[i]=(((k[4*i]<<24)|(k[4*i+1]<<16)|(k[4*i+2]<<8)|k[4*i+3])>>>0);for(let i=Nk;i<4*(Nr+1);i++){let t=w[i-1];if(i%Nk===0){t=((t<<8)|(t>>>24))>>>0;t=((SBOX[(t>>>24)&255]<<24)|(SBOX[(t>>>16)&255]<<16)|(SBOX[(t>>>8)&255]<<8)|SBOX[t&255])>>>0;t=(t^((RCON[i/Nk]<<24)>>>0))>>>0;}else if(i%Nk===4){t=((SBOX[(t>>>24)&255]<<24)|(SBOX[(t>>>16)&255]<<16)|(SBOX[(t>>>8)&255]<<8)|SBOX[t&255])>>>0;}w[i]=(w[i-Nk]^t)>>>0;}return w;}
function encryptBlock(w,inp){let s0=(((inp[0]<<24)|(inp[1]<<16)|(inp[2]<<8)|inp[3])>>>0),s1=(((inp[4]<<24)|(inp[5]<<16)|(inp[6]<<8)|inp[7])>>>0),s2=(((inp[8]<<24)|(inp[9]<<16)|(inp[10]<<8)|inp[11])>>>0),s3=(((inp[12]<<24)|(inp[13]<<16)|(inp[14]<<8)|inp[15])>>>0);s0=(s0^w[0])>>>0;s1=(s1^w[1])>>>0;s2=(s2^w[2])>>>0;s3=(s3^w[3])>>>0;let t0,t1,t2,t3;for(let r=1;r<14;r++){const o=r*4;t0=(Te0[(s0>>>24)&255]^Te1[(s1>>>16)&255]^Te2[(s2>>>8)&255]^Te3[s3&255]^w[o])>>>0;t1=(Te0[(s1>>>24)&255]^Te1[(s2>>>16)&255]^Te2[(s3>>>8)&255]^Te3[s0&255]^w[o+1])>>>0;t2=(Te0[(s2>>>24)&255]^Te1[(s3>>>16)&255]^Te2[(s0>>>8)&255]^Te3[s1&255]^w[o+2])>>>0;t3=(Te0[(s3>>>24)&255]^Te1[(s0>>>16)&255]^Te2[(s1>>>8)&255]^Te3[s2&255]^w[o+3])>>>0;s0=t0;s1=t1;s2=t2;s3=t3;}const a0=((SBOX[(s0>>>24)&255]<<24)|(SBOX[(s1>>>16)&255]<<16)|(SBOX[(s2>>>8)&255]<<8)|SBOX[s3&255])>>>0,a1=((SBOX[(s1>>>24)&255]<<24)|(SBOX[(s2>>>16)&255]<<16)|(SBOX[(s3>>>8)&255]<<8)|SBOX[s0&255])>>>0,a2=((SBOX[(s2>>>24)&255]<<24)|(SBOX[(s3>>>16)&255]<<16)|(SBOX[(s0>>>8)&255]<<8)|SBOX[s1&255])>>>0,a3=((SBOX[(s3>>>24)&255]<<24)|(SBOX[(s0>>>16)&255]<<16)|(SBOX[(s1>>>8)&255]<<8)|SBOX[s2&255])>>>0;const r0=(a0^w[56])>>>0,r1=(a1^w[57])>>>0,r2=(a2^w[58])>>>0,r3=(a3^w[59])>>>0,out=new Uint8Array(16);out[0]=r0>>>24;out[1]=(r0>>>16)&255;out[2]=(r0>>>8)&255;out[3]=r0&255;out[4]=r1>>>24;out[5]=(r1>>>16)&255;out[6]=(r1>>>8)&255;out[7]=r1&255;out[8]=r2>>>24;out[9]=(r2>>>16)&255;out[10]=(r2>>>8)&255;out[11]=r2&255;out[12]=r3>>>24;out[13]=(r3>>>16)&255;out[14]=(r3>>>8)&255;out[15]=r3&255;return out;}
function mul128(X,Y){let Z=new Uint8Array(16),V=Uint8Array.from(Y);for(let i=0;i<128;i++){if((X[i>>3]>>(7-(i&7)))&1)for(let k=0;k<16;k++)Z[k]^=V[k];const lsb=V[15]&1;let c=0;for(let k=0;k<16;k++){const nb=(V[k]&1)<<7;V[k]=(V[k]>>1)|c;c=nb;}if(lsb)V[0]^=0xe1;}return Z;}
function ghash(H,X){let Y=new Uint8Array(16);for(let i=0;i<X.length;i+=16){for(let j=0;j<16;j++)Y[j]^=(X[i+j]||0);Y=mul128(Y,H);}return Y;}
function inc32(b){for(let i=15;i>=12;i--){b[i]=(b[i]+1)&255;if(b[i])break;}}
const concat=(...a)=>{const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length;}return o;};
const pad16=(b)=>{const r=(16-(b.length%16))%16;if(!r)return b;const o=new Uint8Array(b.length+r);o.set(b);return o;};
function gcmEncrypt(key,iv,pt){const w=keyExp(key),H=encryptBlock(w,new Uint8Array(16)),J0=new Uint8Array(16);J0.set(iv,0);J0[15]=1;const out=new Uint8Array(pt.length),ctr=Uint8Array.from(J0);for(let i=0;i<pt.length;i+=16){inc32(ctr);const ks=encryptBlock(w,ctr);for(let j=0;j<16&&i+j<pt.length;j++)out[i+j]=pt[i+j]^ks[j];}const bits=pt.length*8,hi=Math.floor(bits/4294967296),lo=bits>>>0,lenb=new Uint8Array(16);lenb[8]=(hi>>>24)&255;lenb[9]=(hi>>>16)&255;lenb[10]=(hi>>>8)&255;lenb[11]=hi&255;lenb[12]=(lo>>>24)&255;lenb[13]=(lo>>>16)&255;lenb[14]=(lo>>>8)&255;lenb[15]=lo&255;const S=ghash(H,concat(pad16(out),lenb)),E=encryptBlock(w,J0),tag=new Uint8Array(16);for(let i=0;i<16;i++)tag[i]=S[i]^E[i];return concat(out,tag);}
function gcmDecrypt(key,iv,data){const ct=data.slice(0,data.length-16),tag=data.slice(data.length-16),w=keyExp(key),H=encryptBlock(w,new Uint8Array(16)),J0=new Uint8Array(16);J0.set(iv,0);J0[15]=1;const bits=ct.length*8,hi=Math.floor(bits/4294967296),lo=bits>>>0,lenb=new Uint8Array(16);lenb[8]=(hi>>>24)&255;lenb[9]=(hi>>>16)&255;lenb[10]=(hi>>>8)&255;lenb[11]=hi&255;lenb[12]=(lo>>>24)&255;lenb[13]=(lo>>>16)&255;lenb[14]=(lo>>>8)&255;lenb[15]=lo&255;const S=ghash(H,concat(pad16(ct),lenb)),E=encryptBlock(w,J0);for(let i=0;i<16;i++)if(tag[i]!==(S[i]^E[i]))throw new Error('bad tag');const out=new Uint8Array(ct.length),ctr=Uint8Array.from(J0);for(let i=0;i<ct.length;i+=16){inc32(ctr);const ks=encryptBlock(w,ctr);for(let j=0;j<16&&i+j<ct.length;j++)out[i+j]=ct[i+j]^ks[j];}return out;}
const K256=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
const rotr=(x,n)=>((x>>>n)|(x<<(32-n)))>>>0;
function sha256(msg){const H=new Uint32Array([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]);const l=msg.length,w1=l+1,pad=(w1%64<=56)?(56-w1%64):(120-w1%64),m=new Uint8Array(l+1+pad+8);m.set(msg);m[l]=0x80;const bl=l*8;m[m.length-1]=bl&255;m[m.length-2]=(bl>>>8)&255;m[m.length-3]=(bl>>>16)&255;m[m.length-4]=(bl>>>24)&255;const w=new Uint32Array(64);for(let i=0;i<m.length;i+=64){for(let j=0;j<16;j++)w[j]=((m[i+j*4]<<24)|(m[i+j*4+1]<<16)|(m[i+j*4+2]<<8)|m[i+j*4+3])>>>0;for(let j=16;j<64;j++){const s0=rotr(w[j-15],7)^rotr(w[j-15],18)^(w[j-15]>>>3),s1=rotr(w[j-2],17)^rotr(w[j-2],19)^(w[j-2]>>>10);w[j]=(w[j-16]+s0+w[j-7]+s1)>>>0;}let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];for(let j=0;j<64;j++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^(~e&g),t1=(h+S1+ch+K256[j]+w[j])>>>0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;}const o=new Uint8Array(32);for(let i=0;i<8;i++){o[i*4]=H[i]>>>24;o[i*4+1]=(H[i]>>>16)&255;o[i*4+2]=(H[i]>>>8)&255;o[i*4+3]=H[i]&255;}return o;}

// ---- Node（服务端，同步；nodeCrypto 由调用方传入 `node:crypto`，保持本模块浏览器可加载）-------------------------
export function deriveKeyNode(qq, saltHex, nodeCrypto) { return nodeCrypto.createHash('sha256').update(keyMaterial(qq, saltHex), 'utf8').digest(); }
export function encryptNode(plaintext, key, nodeCrypto) {
  const iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(String(plaintext), 'utf8')), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}
export function decryptNode(b64, key, nodeCrypto) {
  const b = Buffer.from(String(b64), 'base64');
  const iv = b.subarray(0, 12), tag = b.subarray(b.length - 16), ct = b.subarray(12, b.length - 16);
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ---- 浏览器/通用接口（有 WebCrypto 用 WebCrypto，否则纯 JS）------------------------------------------------------
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto.subtle : null;
export const hasWebCrypto = () => !!subtle();

/** @returns {Promise<Uint8Array>} 32 字节密钥 */
export async function deriveKeyBytes(qq, saltHex) {
  const s = subtle();
  if (s) {
    const bits = await s.digest('SHA-256', enc(keyMaterial(qq, saltHex)));
    return new Uint8Array(bits);
  }
  return sha256(enc(keyMaterial(qq, saltHex)));
}
/** 加密为 base64(iv||ct||tag)。 */
export async function encryptPayload(plaintext, keyBytes) {
  const s = subtle();
  if (s) {
    const k = await s.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv }, k, enc(String(plaintext))));
    const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
    return toB64(out);
  }
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return toB64(concat(Uint8Array.from(iv), gcmEncrypt(keyBytes, Uint8Array.from(iv), enc(String(plaintext)))));
}
/** 解密 base64(iv||ct||tag)。失败抛错。 */
export async function decryptPayload(b64, keyBytes) {
  const s = subtle();
  if (s) {
    const k = await s.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const b = fromB64(b64);
    const pt = await s.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, k, b.subarray(12));
    return dec(new Uint8Array(pt));
  }
  const b = fromB64(b64);
  return dec(gcmDecrypt(keyBytes, b.subarray(0, 12), b.subarray(12)));
}

function toB64(u8) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
