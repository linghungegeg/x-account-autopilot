// 图片/视频格式嗅探：纯函数，不依赖 chrome API，可在 Node 下直接单测。
//
// 实测（probe/result-live-media.json、result-live-video.json）：
//   X 的 fileInput accept = image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime
//   图片走 media_category=tweet_image，视频走 media_category=amplify_video
// 中转站经常无视 response_format 直接回 jpeg/webp，MIME 标错会被 X 静默拒收。

// 从 base64 头部按魔数判断真实格式，判断不出来时按 png 处理
export function sniffMimeFromBase64(base64) {
  let head;
  try {
    head = atob(String(base64).slice(0, 24));
  } catch {
    return 'image/png';
  }
  if (head.length < 12) return 'image/png';

  const code = index => head.charCodeAt(index);
  if (code(0) === 0x89 && code(1) === 0x50 && code(2) === 0x4e && code(3) === 0x47) return 'image/png';
  if (code(0) === 0xff && code(1) === 0xd8 && code(2) === 0xff) return 'image/jpeg';
  if (code(0) === 0x47 && code(1) === 0x49 && code(2) === 0x46) return 'image/gif';
  if (code(0) === 0x52 && code(1) === 0x49 && code(2) === 0x46 && code(3) === 0x46 && head.slice(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // MP4/MOV 家族：第 4-8 字节是 'ftyp'
  if (head.slice(4, 8) === 'ftyp') {
    const brand = head.slice(8, 12);
    return brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
  }
  // WebM/Matroska：EBML 头
  if (code(0) === 0x1a && code(1) === 0x45 && code(2) === 0xdf && code(3) === 0xa3) return 'video/webm';
  return 'image/png';
}

export function isVideoMime(mime) {
  return String(mime || '').startsWith('video/');
}
