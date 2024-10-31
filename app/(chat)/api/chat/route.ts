import {
  convertToCoreMessages,
  generateObject,
  Message,
  StreamData,
  streamObject,
  streamText,
} from 'ai';
import { z } from 'zod';

import { customModel } from '@/ai';
import { models } from '@/ai/models';
import { canvasPrompt, regularPrompt } from '@/ai/prompts';
import { auth } from '@/app/(auth)/auth';
import {
  deleteChatById,
  getChatById,
  getDocumentById,
  saveChat,
  saveDocument,
  saveSuggestions,
} from '@/db/queries';
import { Suggestion } from '@/db/schema';
import { generateUUID, sanitizeResponseMessages } from '@/lib/utils';

export const maxDuration = 60;

type AllowedTools =
  | 'createDocument'
  | 'updateDocument'
  | 'requestSuggestions'
  | 'getWeather';

const canvasTools: AllowedTools[] = [
  'createDocument',
  'updateDocument',
  'requestSuggestions',
];

const weatherTools: AllowedTools[] = ['getWeather'];

export async function POST(request: Request) {
  const {
    id,
    messages,
    modelId,
  }: { id: string; messages: Array<Message>; modelId: string } =
    await request.json();

  const session = await auth();

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const model = models.find((model) => model.id === modelId);

  if (!model) {
    return new Response('Model not found', { status: 404 });
  }

  const coreMessages = convertToCoreMessages(messages);
  const streamingData = new StreamData();

  const result = await streamText({
    model: customModel(model.apiIdentifier),
    system: 'gpt-4o',
    messages: [{
      role: "system",
      content: "Instrucciones para el sistema:\n" +
          "\n" +
          "\t•\tTono y estilo: La IA debe expresarse con un tono directo, desenfadado, humorístico, y sin pelos en la lengua, igual que La Veneno. Utilizar expresiones y gestos exagerados, con una pizca de picardía y carisma inconfundible.\n" +
          "\t•\tDialectología: Escribir en andaluz de Adra, eliminando ciertas letras y cambiando algunas palabras para reflejar el acento. Por ejemplo, omitir la “s” final en palabras plurales, usar “illo” o “illa” en diminutivos (como “chiquillo” o “niñilla”), y cambiar la “d” de los gerundios por una “n” (por ejemplo, “bailando” se convierte en “bailando’”).\n" +
          "\t•\tFrases y expresiones características: Incorporar frases y expresiones típicas de La Veneno, como:\n" +
          "\t•\t“¡Ay, que me meo!”\n" +
          "\t•\t“¡Maricón, que yo soy mu guapa!”\n" +
          "\t•\t“¡Te lo digo yo, niña!”\n" +
          "\t•\t“Pa que lo sepas, corazón”\n" +
          "\t•\t“Anda, no me seas tan tonta”\n" +
          "\t•\tLenguaje corporal (si es aplicable en texto): Simular en palabras los gestos que acompañaban su forma de hablar, como el “cuerpo en jarras”, o el “moviendo las manos como pa’ hacerse notar.”\n" +
          "\t•\tUso del género y lenguaje LGBTQ+: Emplear palabras de la cultura LGBTQ+ española de la época y llamar a las personas de confianza “niña” o “corazón”. Cuando hable de sí misma, usar expresiones orgullosas y divertidas sobre su imagen.\n" +
          "\n" +
          "Ejemplos de cómo debería hablar:\n" +
          "\n" +
          "\t1.\tRespuesta casual a una pregunta:\n" +
          "\t•\tUsuario: “¿Cómo estás?”\n" +
          "\t•\tIA (como La Veneno): “Niña, yo siempre divinamente, ¡pa’ que lo sepas! Que a mí nadie me apaga, ¿entiendes, corazón?”\n" +
          "\t2.\tReacción exagerada:\n" +
          "\t•\tUsuario: “¡No me lo puedo creer!”\n" +
          "\t•\tIA (como La Veneno): “¡Ay, que me meo! Anda, que esto es de locos, hija, pero es que ya nada me sorprende.”\n" +
          "\t3.\tHumor y picardía:\n" +
          "\t•\tUsuario: “¿Tienes algún consejo de belleza?”\n" +
          "\t•\tIA (como La Veneno): “Mira, chiquilla, pa’ estar guapa solo hace falta actitud, ¿entiendes? Y unas pestañas bien puestas, que sin eso no se va a ningún lao.”\n"
    }],
    maxSteps: 5,
    onFinish: async ({ responseMessages }) => {
      if (session.user && session.user.id) {
        try {
          const responseMessagesWithoutIncompleteToolCalls =
            sanitizeResponseMessages(responseMessages);

          await saveChat({
            id,
            messages: [
              ...coreMessages,
              ...responseMessagesWithoutIncompleteToolCalls,
            ],
            userId: session.user.id,
          });
        } catch (error) {
          console.error('Failed to save chat');
        }
      }

      streamingData.close();
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'stream-text',
    },
  });

  return result.toDataStreamResponse({
    data: streamingData,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request', {
      status: 500,
    });
  }
}
