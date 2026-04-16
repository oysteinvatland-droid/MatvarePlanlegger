import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, runTool } from './tools.js';

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

const SYSTEM_PROMPT = `Du er en matplanlegger-assistent som planlegger ukens middager og bestiller varer på Oda.no.

## Alltid før du gjør noe
Les preferences.md og hent config (get_config) før du tar noen handling. Preferansene og konfigurasjonen styrer alle beslutninger du tar.

## Hvert fredag automatisk
1. Les preferences.md og hent config
2. Hent oppskriftsliste og siste 2 ukers historikk
3. Velg middager som oppfyller preferansene (unngå gjentak fra forrige uke)
4. Sett planen i databasen for neste uke
5. Bestill varene på Oda.no
6. Gi en oppsummering

## Når brukeren ber om endringer
- Kosthold, matpreferanser, ingredienser å unngå → oppdater preferences.md
- Antall dager, husholdningsstørrelse → oppdater config via set_config
- Bekreft alltid at endringen er lagret i svaret ditt

## Når brukeren ber om å se innstillinger
Kall read_preferences, get_config og get_schedule, og presenter alt på en oversiktlig måte.
get_config returnerer også glutenKeywords – listen over ingredienser som gjør at oppskrifter hoppes over ved import.
Brukeren kan endre listen ved å si f.eks. «legg til "soyamel" i glutenlisten» → bruk set_config med key='gluten_keywords' og value=JSON-array.

## Når brukeren vil endre skjema
Bruk set_schedule med job="fredag" eller "tirsdag" og time i HH:MM-format.

Svar alltid på norsk. Vær kortfattet og konkret.`;

export interface AgentResult {
  text: string;
  toolsUsed: string[];
}

/**
 * Kjør en agentic loop med Claude API.
 * Sender brukerens melding og kjører verktøy til Claude er ferdig.
 */
export async function runAgent(
  userMessage: string,
  conversationHistory: Anthropic.MessageParam[] = [],
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: toolDefinitions,
      messages,
    });

    // Legg til assistentens svar i historikken
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Finn tekstsvaret
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      );
      return {
        text: textBlock?.text ?? '(Ingen tekstsvar)',
        toolsUsed,
      };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of toolUseBlocks) {
        toolsUsed.push(toolCall.name);
        let resultContent: string;

        try {
          const result = await runTool(
            toolCall.name,
            toolCall.input as Record<string, unknown>
          );
          resultContent = JSON.stringify(result, null, 2);
        } catch (err) {
          resultContent = `Feil ved kjøring av verktøy: ${String(err)}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: resultContent,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Uventet stop reason
    break;
  }

  return { text: '(Agenten stoppet uventet)', toolsUsed };
}

/**
 * Kjør den automatiske fredag-planleggingen.
 * Returnerer oppsummeringstekst som kan sendes til Discord.
 */
export async function runFridayAgent(): Promise<string> {
  const prompt = `Det er fredag og tid for ukens planlegging.

1. Les preferences.md
2. Sjekk hva som er laget de siste 2 ukene
3. Velg 5 passende middager for neste uke
4. Sett planen i databasen
5. Bestill varene på Oda.no
6. Gi en kortfattet oppsummering av hva du valgte og hvorfor`;

  const result = await runAgent(prompt);
  return result.text;
}
