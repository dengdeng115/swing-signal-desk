import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedDiscordMessage } from '../server/src/services/discord-bot.js';

const config = {
  subscriptions: [
    { guildId: 'guild-1', channelId: 'channel-1', authorIds: ['author-1', 'author-2'] },
    { guildId: 'guild-1', channelId: 'channel-2', authorIds: ['author-3'] },
    { guildId: 'guild-2', channelId: 'channel-all', authorIds: [] }
  ]
};

test('accepts every configured author within its own channel scope', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-1', bot: false } }, config), true);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-2', bot: false } }, config), true);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-2', author: { id: 'author-3', bot: false } }, config), true);
});

test('does not cross-match an author into a different configured channel', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-2', author: { id: 'author-1', bot: false } }, config), false);
});

test('an empty author list accepts every non-bot author in that channel', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-2', channelId: 'channel-all', author: { id: 'any-human', bot: false } }, config), true);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-2', channelId: 'channel-all', author: { id: 'some-bot', bot: true } }, config), false);
});

test('accepts only an explicitly allowlisted relay bot and never the collector itself', () => {
  assert.equal(isAllowedDiscordMessage(
    { guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-1', bot: true } },
    config,
    'create',
    'collector-bot'
  ), true);
  assert.equal(isAllowedDiscordMessage(
    { guildId: 'guild-1', channelId: 'channel-1', author: { id: 'unlisted-bot', bot: true } },
    config,
    'create',
    'collector-bot'
  ), false);
  assert.equal(isAllowedDiscordMessage(
    { guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-1', bot: true } },
    config,
    'create',
    'author-1'
  ), false);
});

test('keeps in-scope partial delete events for message-id correlation', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1' }, config, 'delete'), true);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'not-configured' }, config, 'delete'), false);
});
