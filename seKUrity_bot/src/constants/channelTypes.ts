export enum ChannelSettingType {
  Logs = 'logs',
  Scrums = 'scrums',
  Approvals = 'approve',
  Weekly = 'weekly',
}

export const CHANNEL_SETTING_CHOICES = [
  {
    name: 'logs',
    value: ChannelSettingType.Logs,
  },
  {
    name: 'scrums',
    value: ChannelSettingType.Scrums,
  },
  {
    name: 'approve',
    value: ChannelSettingType.Approvals,
  },
  {
    name: 'weekly',
    value: ChannelSettingType.Weekly,
  },
] as const;
