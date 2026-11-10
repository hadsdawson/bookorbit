import { isBookRequestFulfiller, isCancellableBookRequestStatus, isSettledBookRequestStatus } from '@bookorbit/types'
import type { BookRequestItem } from '@bookorbit/types'

/**
 * Who may do what to a request, in one place. The list, the table and the detail page all offer
 * the same three actions, and three copies of these rules is how a card ends up offering a button
 * the endpoint refuses.
 */

/**
 * The requester, a moderator, or the self-fulfiller who took the request on. The last of those is
 * the only person who can stop a transfer they started on somebody else's row, so hiding the
 * action from them would leave work that only runs forwards. `canSelfFulfil` is asked for the same
 * reason the server asks: the permission can be taken away after the request was taken on.
 */
export function canCancelRequest(request: BookRequestItem, userId: number | null, canManage: boolean, canSelfFulfil = false): boolean {
  const isOwner = userId !== null && request.userId === userId
  const drives = canSelfFulfil && isBookRequestFulfiller(request, userId)
  return (isOwner || canManage || drives) && isCancellableBookRequestStatus(request.status)
}

/** Hiding is personal, so anyone who can see a settled request may take it off their own list. */
export function canDismissRequest(request: BookRequestItem): boolean {
  return isSettledBookRequestStatus(request.status)
}

/**
 * Whether the tracking note can be set on this request: by whoever may drive it, and only while it
 * still has something to wait for. Mirrors the server, which refuses anyone else.
 */
export function canTrackRequest(request: BookRequestItem, userId: number | null, canManage: boolean, canSelfFulfil = false): boolean {
  if (request.status === 'available') return false
  if (canManage) return true
  if (userId === null) return false
  return request.userId === userId || (canSelfFulfil && request.fulfillerUserId === userId)
}

export interface BulkActor {
  userId: number | null
  canManage: boolean
  canSelfFulfil: boolean
}

/**
 * Whether ticking this row would let the bulk bar offer anything. A row earns a checkbox when at
 * least one bulk action can reach it: approve or reject, dismiss, set tracking, cancel, or delete.
 */
export function canBulkActRequest(request: BookRequestItem, actor: BulkActor): boolean {
  if (actor.canManage && request.status === 'pending') return true
  if (canDismissRequest(request) && !request.dismissed) return true
  if (canTrackRequest(request, actor.userId, actor.canManage, actor.canSelfFulfil)) return true
  if (canCancelRequest(request, actor.userId, actor.canManage, actor.canSelfFulfil)) return true
  return canDeleteRequest(request, actor.canManage)
}

/**
 * Whether the signed-in user joined this request rather than making it, and so has something to
 * leave. The fulfiller is excluded: their subscription is what makes their own work visible to
 * them, and the server refuses for that reason too.
 */
export function canLeaveRequest(request: BookRequestItem, userId: number | null): boolean {
  if (userId === null || request.userId === userId) return false
  if (isBookRequestFulfiller(request, userId)) return false
  return request.subscribers.some((subscriber) => subscriber.userId === userId)
}

/** Deleting takes the row from everyone, so it is a moderator action on a settled request only. */
export function canDeleteRequest(request: BookRequestItem, canManage: boolean): boolean {
  return canManage && isSettledBookRequestStatus(request.status)
}

/**
 * Whether cancelling would also stop an active transfer, which is worth warning about. Read off
 * the attempt rather than the request: a request can sit at `searching` with nothing grabbed yet.
 * Mirrors the in-flight statuses the server removes on.
 */
export function cancelStopsATransfer(request: BookRequestItem): boolean {
  if (request.download?.alwaysDeletesRemote) return true
  const status = request.download?.status
  return status === 'queued' || status === 'downloading' || status === 'completed' || status === 'importing'
}
