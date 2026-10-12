// 실제 서버(/player/me/*)용 StoryClient. 판정은 전부 서버가 하고 여기서는 응답 모양만 맞춘다.
import { completeStoryEvent, fetchDialogue, fetchStoryFull, saveProfileName, type StoryStateFull } from '../api/client';
import type { DialogueFile } from './dialogueRunner';
import type { OpeningStoryState, StoryClient } from './storyClient';

const toOpening = (s: StoryStateFull): OpeningStoryState => ({ checkpoint: s.checkpoint, needsName: s.needsName, playerName: s.playerName, resume: { segmentId: s.resume.segmentId }, openingRequired: s.openingRequired, openingAvailable: s.openingAvailable, openingStarted: s.openingStarted });

export const apiStoryClient: StoryClient = {
  fetchState: async () => toOpening(await fetchStoryFull()),
  fetchDialogue: async (chapterCode) => (await fetchDialogue(chapterCode)) as DialogueFile,
  completeEvent: async (eventId) => toOpening((await completeStoryEvent(eventId)).story),
  saveName: async (name) => toOpening((await saveProfileName(name)).story),
};
