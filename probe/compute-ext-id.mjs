// 复现 Chrome 为"已解压扩展"生成 ID 的算法，拿已知 ID 标定。
//
// Chrome 源码 crx_file/id_util.cc：
//   MaybeNormalizePath: Windows 下把盘符转成大写，再 WideToUTF8
//   GenerateId: SHA256(路径)，取前 16 字节，HexEncode 成 32 个 hex 字符，
//               再把 0-f 映射到 a-p
import { createHash } from 'node:crypto';

const toId = rawPath => {
  // Windows：盘符大写
  let p = rawPath;
  if (p.length >= 2 && p[1] === ':' && /[a-z]/.test(p[0])) {
    p = p[0].toUpperCase() + p.slice(1);
  }
  const hash = createHash('sha256').update(p, 'utf8').digest();
  const hex = hash.subarray(0, 16).toString('hex');   // 32 个 hex 字符
  return hex.replace(/[0-9a-f]/g, c => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)));
};

// 标定：0.3.1 那个目录当时的 ID 是已知的
const known = 'E:\\x\\dist\\x-nurture-helper-0.3.1';
const expected = 'kfdgfjbdhajdfflcolociedlbcameink';
const computed = toId(known);

console.log('标定（用已知的 0.3.1 目录）');
console.log('  路径:     ' + known);
console.log('  期望 ID:  ' + expected);
console.log('  算出 ID:  ' + computed);
console.log('  ' + (computed === expected ? '✅ 算法正确' : '❌ 算法不对，不能用这个办法'));

if (computed === expected) {
  console.log('\n各候选目录的 ID:');
  for (const p of [
    'E:\\x\\dist\\x-nurture-helper-0.4.0',
    'E:\\x',
    'e:\\x\\dist\\x-nurture-helper-0.4.0'
  ]) {
    console.log(`  ${toId(p)}   <- ${p}`);
  }
}
