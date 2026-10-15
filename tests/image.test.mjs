// 媒体格式嗅探：中转站经常无视 response_format 回 jpeg/webp，
// MIME 判断错了 X 的 fileInput 会静默拒收，所以这部分单独测。
//
// 期望值来自实测：
//   probe/result-live-media.json  → 图片上传 media_category=tweet_image
//   probe/result-live-video.json  → 视频上传 media_category=amplify_video
//   fileInput accept = image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime

import test from 'node:test';
import assert from 'node:assert/strict';

import { sniffMimeFromBase64, isVideoMime } from '../src/lib/image.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const WEBP = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=';
// ftypisom —— MP4
const MP4 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAACh3aWR0aA==';
// ftypqt  —— QuickTime/MOV
const MOV = 'AAAAIGZ0eXBxdCAgAAACAG1vb3ZxdCAgAAAobXA0Mg==';

test('按魔数识别图片格式', () => {
  assert.equal(sniffMimeFromBase64(PNG), 'image/png');
  assert.equal(sniffMimeFromBase64(JPEG), 'image/jpeg');
  assert.equal(sniffMimeFromBase64(GIF), 'image/gif');
  assert.equal(sniffMimeFromBase64(WEBP), 'image/webp');
});

test('按 ftyp 品牌区分 MP4 与 QuickTime', () => {
  assert.equal(sniffMimeFromBase64(MP4), 'video/mp4');
  assert.equal(sniffMimeFromBase64(MOV), 'video/quicktime');
});

test('识别不出来时回落到 png，不抛异常', () => {
  assert.equal(sniffMimeFromBase64(''), 'image/png');
  assert.equal(sniffMimeFromBase64('!!!!'), 'image/png');
  assert.equal(sniffMimeFromBase64('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 'image/png');
  assert.equal(sniffMimeFromBase64(null), 'image/png');
  assert.equal(sniffMimeFromBase64(undefined), 'image/png');
});

test('isVideoMime 只认 video/ 前缀', () => {
  assert.equal(isVideoMime('video/mp4'), true);
  assert.equal(isVideoMime('video/quicktime'), true);
  assert.equal(isVideoMime('image/png'), false);
  assert.equal(isVideoMime(''), false);
  assert.equal(isVideoMime(undefined), false);
});

test('嗅探结果都落在 X fileInput 的 accept 白名单里', () => {
  // 这串来自真实抓取：probe/result-live-media.json 的 before.accept
  const accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime'.split(',');
  for (const payload of [PNG, JPEG, GIF, WEBP, MP4, MOV, '', 'garbage']) {
    const mime = sniffMimeFromBase64(payload);
    assert.ok(accept.includes(mime), `${payload.slice(0, 12)} 嗅探出 ${mime}，不在 X 的白名单内`);
  }
});
