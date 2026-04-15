import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  type Snowflake,
} from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { runAgent } from './agent.js';

// Konversasjonshistorikk per kanal (in-memory, nullstilles ved restart)
const conversationHistory = new Map<Snowflake, Anthropic.MessageParam[]>();
const MAX_HISTORY = 20; // Maks antall meldinger å huske per kanal

let discordClient: Client | null = null;

export function getDiscordClient(): Client {
  if (!discordClient) throw new Error('Discord-klienten er ikke startet enda.');
  return discordClient;
}

/**
 * Send en melding til Discord-kanalen.
 */
export async function sendToDiscord(text: string): Promise<void> {
  const channelId = process.env['DISCORD_CHANNEL_ID'];
  if (!channelId) {
    console.error('DISCORD_CHANNEL_ID er ikke satt');
    return;
  }

  const client = getDiscordClient();
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    console.error(`Kanal ${channelId} ikke funnet eller er ikke en tekstkanal`);
    return;
  }

  // Discord har en grense på 2000 tegn per melding
  const chunks = splitMessage(text, 2000);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

/**
 * Del opp en lang melding i Discord-vennlige biter.
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Prøv å bryte ved linjeskift
    const breakAt = remaining.lastIndexOf('\n', maxLength);
    const splitAt = breakAt > 0 ? breakAt : maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/**
 * Start Discord-boten og lytt på meldinger.
 */
export async function startDiscordBot(): Promise<void> {
  const token = process.env['DISCORD_TOKEN'];
  const channelId = process.env['DISCORD_CHANNEL_ID'];

  if (!token) throw new Error('DISCORD_TOKEN er ikke satt i miljøvariabler.');
  if (!channelId) throw new Error('DISCORD_CHANNEL_ID er ikke satt i miljøvariabler.');

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  discordClient.on('ready', () => {
    console.log(`Discord-bot pålogget som ${discordClient!.user?.tag}`);
  });

  discordClient.on('messageCreate', async (message: Message) => {
    // Ignorer meldinger fra boten selv og andre kanaler
    if (message.author.bot) return;
    if (message.channelId !== channelId) return;

    const userText = message.content.trim();
    if (!userText) return;

    // Vis at boten jobber
    if ('sendTyping' in message.channel) {
      await (message.channel as TextChannel).sendTyping();
    }

    try {
      // Hent eller opprett konversasjonshistorikk for denne kanalen
      const history = conversationHistory.get(message.channelId) ?? [];

      const result = await runAgent(userText, history);

      // Oppdater historikken
      const updatedHistory: Anthropic.MessageParam[] = [
        ...history,
        { role: 'user', content: userText },
        { role: 'assistant', content: result.text },
      ];

      // Behold bare de siste MAX_HISTORY meldingene
      const trimmed = updatedHistory.slice(-MAX_HISTORY);
      conversationHistory.set(message.channelId, trimmed);

      // Send svar til Discord
      const chunks = splitMessage(result.text, 2000);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } catch (err) {
      console.error('Feil ved håndtering av Discord-melding:', err);
      await message.reply('Beklager, det oppstod en feil. Prøv igjen om litt.');
    }
  });

  await discordClient.login(token);
}
