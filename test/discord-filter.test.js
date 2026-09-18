import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedDiscordMessage } from '../server/src/services/discord-bot.js';

const config = {
  guildId: 'guild-1',
  channelIds: ['channel-1'],
  authorIds: ['author-1']
};

test('accepts only the configured guild, channel and author', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-1', bot: false } }, config), true);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-2', channelId: 'channel-1', author: { id: 'author-1', bot: false } }, config), false);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-2', author: { id: 'author-1', bot: false } }, config), false);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-2', bot: false } }, config), false);
});

test('rejects messages authored by bots', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1', author: { id: 'author-1', bot: true } }, config), false);
});

test('keeps partial delete events in scope so they can be correlated by message id', () => {
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-1' }, config, 'delete'), true);
  assert.equal(isAllowedDiscordMessage({ guildId: 'guild-1', channelId: 'channel-2' }, config, 'delete'), false);
});
