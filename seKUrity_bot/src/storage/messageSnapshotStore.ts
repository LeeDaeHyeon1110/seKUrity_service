import path from 'node:path';
import { readJson, writeJson } from './jsonStore';

export interface MessageAttachmentSnapshot {
  name: string | null;
  url: string;
}

export interface MessageSnapshot {
  messageId: string;
  guildId: string | null;
  channelId: string;
  authorId: string | null;
  authorTag: string;
  content: string;
  attachments: MessageAttachmentSnapshot[];
  recordedAt: string;
}

interface MessageSnapshots {
  messages: Record<string, MessageSnapshot>;
}

const SNAPSHOTS_PATH = path.join(process.cwd(), 'data', 'message-snapshots.json');
const DEFAULT_SNAPSHOTS: MessageSnapshots = {
  messages: {},
};

function readSnapshots(): MessageSnapshots {
  return readJson(SNAPSHOTS_PATH, DEFAULT_SNAPSHOTS);
}

function writeSnapshots(snapshots: MessageSnapshots): void {
  writeJson(SNAPSHOTS_PATH, snapshots);
}

export function getMessageSnapshot(messageId: string): MessageSnapshot | null {
  const snapshots = readSnapshots();
  return snapshots.messages[messageId] ?? null;
}

export function saveMessageSnapshot(snapshot: MessageSnapshot): void {
  const snapshots = readSnapshots();
  snapshots.messages[snapshot.messageId] = snapshot;
  writeSnapshots(snapshots);
}

export function takeMessageSnapshots(
  messageIds: string[],
): Map<string, MessageSnapshot> {
  const snapshots = readSnapshots();
  const taken = new Map<string, MessageSnapshot>();
  let changed = false;

  for (const messageId of messageIds) {
    const snapshot = snapshots.messages[messageId];

    if (!snapshot) {
      continue;
    }

    taken.set(messageId, snapshot);
    delete snapshots.messages[messageId];
    changed = true;
  }

  if (changed) {
    writeSnapshots(snapshots);
  }

  return taken;
}
