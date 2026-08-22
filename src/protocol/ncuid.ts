// ===== NCUID 兼容层 =====
// 直接移植自 oldchat-kivotos-next/src/app.js（63cede3 版本）
// ncuid 给机器看（API 调用），uid 给人看（界面显示）
// 注意：ncuid 不一定以 nc_ 开头（官方文档示例值为 USR-ABCD1234）
// 服务端在 ?uid=/with_uid/to_uid 参数中同时接受 uid 和 ncuid 值，
// 因此不再需要前缀判断，统一使用 _uid 系列参数即可。

/** 从对象取 API 用 ID（ncuid 优先） */
export function getUid(obj: any): string {
  if (!obj) return '';
  return obj.ncuid || obj.uid || '';
}

/** 从对象取显示用 ID（uid 优先） */
export function getDisplayUid(obj: any): string {
  if (!obj) return '';
  return obj.uid || obj.ncuid || '';
}

/** 从消息对象取发送者 ID */
export function getFromUid(obj: any): string {
  if (!obj) return '';
  return obj.from_ncuid || obj.from_uid || obj.sender_ncuid || obj.sender_uid || '';
}

/** 从消息对象取发送者昵称 */
export function getFromName(obj: any): string {
  if (!obj) return '';
  return obj.from_name || obj.sender_name || obj.display_name || '';
}

/** 从消息对象取发送者头像 */
export function getFromAvatar(obj: any): string {
  if (!obj) return '';
  return obj.from_avatar || obj.sender_avatar || obj.avatar_url || '';
}

/** ID 相等比较（忽略大小写） */
export function uidEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * 判断某个发送者 ID 是否是自己（兼容 uid/ncuid 两种格式）。
 * myUid 优先 ncuid，myDisplayUid 是旧 uid；消息历史可能返回任一格式。
 */
export function isSelfUid(fromUid: string, myUid: string, myDisplayUid?: string): boolean {
  if (!fromUid) return false;
  return uidEq(fromUid, myUid) || (!!myDisplayUid && uidEq(fromUid, myDisplayUid));
}

/** 构建私聊目标参数：服务端 to_uid 同时接受 uid/ncuid */
export function toUidParam(id: string): Record<string, string> {
  return { to_uid: id };
}

/** 构建私聊历史/已读参数：服务端 with_uid 同时接受 uid/ncuid */
export function withUidParam(id: string): Record<string, string> {
  return { with_uid: id };
}

/** 构建用户资料查询参数：服务端 ?uid= 同时接受 uid/ncuid */
export function profileQuery(id: string): string {
  return '/v1/users/profile?uid=' + encodeURIComponent(id);
}
