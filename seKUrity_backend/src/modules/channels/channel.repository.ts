import { and, eq } from 'drizzle-orm';
import type { ChannelSettingType } from '../../contracts';
import type { Database } from '../../db/database';
import { guildChannelSettings } from '../../db/schema';

export class ChannelRepository {
  constructor(private readonly database: Database) {}

  async get(
    guildId: string,
    type: ChannelSettingType,
  ): Promise<string | null> {
    const [setting] = await this.database
      .select({ channelId: guildChannelSettings.channelId })
      .from(guildChannelSettings)
      .where(and(
        eq(guildChannelSettings.guildId, guildId),
        eq(guildChannelSettings.type, type),
      ))
      .limit(1);

    return setting?.channelId ?? null;
  }

  async set(
    guildId: string,
    type: ChannelSettingType,
    channelId: string,
  ): Promise<string> {
    const [setting] = await this.database
      .insert(guildChannelSettings)
      .values({
        guildId,
        type,
        channelId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          guildChannelSettings.guildId,
          guildChannelSettings.type,
        ],
        set: {
          channelId,
          updatedAt: new Date(),
        },
      })
      .returning({ channelId: guildChannelSettings.channelId });

    return setting.channelId;
  }

  async unset(
    guildId: string,
    type: ChannelSettingType,
  ): Promise<string | null> {
    const [setting] = await this.database
      .delete(guildChannelSettings)
      .where(and(
        eq(guildChannelSettings.guildId, guildId),
        eq(guildChannelSettings.type, type),
      ))
      .returning({ channelId: guildChannelSettings.channelId });

    return setting?.channelId ?? null;
  }
}
