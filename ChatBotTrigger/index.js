const { WebClient } = require('@slack/web-api');
const {
  ChatCompletionRequestMessageRoleEnum,
  Configuration,
  OpenAIApi,
} = require('openai');

const openaiClient = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
    basePath: process.env.OPENAI_API_URL + process.env.OPENAI_API_MODEL,
    baseOptions: {
      headers: { 'api-key': process.env.OPENAI_API_KEY },
      params: {
        'api-version': '2023-03-15-preview',
      },
    },
  })
);
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const GPT_BOT_USER_ID = process.env.GPT_BOT_USER_ID;
const CHAT_GPT_SYSTEM_PROMPT = process.env.CHAT_GPT_SYSTEM_PROMPT;
const GPT_THREAD_MAX_COUNT = process.env.GPT_THREAD_MAX_COUNT;

/**
 * Slackへメッセージを投稿する
 * @param {string} channel 投稿先のチャンネル
 * @param {string} text 投稿するメッセージ
 * @param {string} threadTs 投稿先がスレッドの場合の設定
 * @param {object} context Azure Functions のcontext
 */
const postMessage = async (channel, text, threadTs, context) => {
  // context.log(text);
  await slackClient.chat.postMessage({
    channel: channel,
    text: text,
    thread_ts: threadTs,
  });
};

/**
 * ChatGPTからメッセージを受け取る
 * @param {string} messages 尋ねるメッセージ
 * @param {object} context Azure Functions のcontext
 * @returns content
 */
const createCompletion = async (messages, context) => {
  try {
    const response = await openaiClient.createChatCompletion({
      messages: messages,
      max_tokens: 800,
      temperature: 0.7,
      frequency_penalty: 0,
      presence_penalty: 0,
      top_p: 0.95,
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    context.log.error(err);
    return err.response.statusText;
  }
};

module.exports = async function (context, req) {
  // Ignore retry requests
  if (req.headers['x-slack-retry-num']) {
    context.log('Ignoring Retry request: ' + req.headers['x-slack-retry-num']);
    context.log(req.body);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No need to resend' }),
    };
  }

  // Response slack challenge requests
  const body = eval(req.body);
  if (body?.challenge) {
    context.log('Challenge: ' + body.challenge);
    context.res = {
      body: body.challenge,
    };
    return;
  }

  // context.log(req.body);
  const event = body.event;
  const threadTs = event?.thread_ts ?? event?.ts;
  if (event?.type === 'message') {
    try {
      const threadMessagesResponse = await slackClient.conversations.replies({
        channel: event.channel,
        ts: threadTs,
      });
      if (threadMessagesResponse.ok !== true) {
        await postMessage(
          event.channel,
          '[Bot]メッセージの取得に失敗しました。',
          threadTs,
          context
        );
        return;
      }
      // context.log('threadMessagesResponse');
      // context.log(threadMessagesResponse);
      const botMessages = threadMessagesResponse.messages
        .sort((a, b) => Number(a.ts) - Number(b.ts))
        .filter(
          (message) =>
            message.text.includes(GPT_BOT_USER_ID) ||
            message.user == GPT_BOT_USER_ID
        )
        .slice(GPT_THREAD_MAX_COUNT * -1)
        .map((m) => {
          const role = m.bot_id
            ? ChatCompletionRequestMessageRoleEnum.Assistant
            : ChatCompletionRequestMessageRoleEnum.User;
          return { role: role, content: m.text.replace(/]+>/g, '') };
        });
      if (botMessages.length < 1) {
        await postMessage(
          event.channel,
          '[Bot]質問メッセージが見つかりませんでした。@chatgptbot を付けて質問してみて下さい。',
          threadTs,
          context
        );
        return;
      }
      // context.log('botMessages');
      // context.log(botMessages[botMessages.length - 1].role);
      const lastMessage = botMessages[botMessages.length - 1];
      if (lastMessage.role == ChatCompletionRequestMessageRoleEnum.User) {
        var postMessages = [
          {
            role: ChatCompletionRequestMessageRoleEnum.System,
            content: CHAT_GPT_SYSTEM_PROMPT,
          },
          ...botMessages,
        ];
        const openaiResponse = await createCompletion(postMessages, context);
        if (openaiResponse == null || openaiResponse == '') {
          await postMessage(
            event.channel,
            '[Bot]ChatGPTから返信がありませんでした。この症状は、ChatGPTのサーバーの調子が悪い時に起こります。少し待って再度試してみて下さい。',
            threadTs,
            context
          );
          return { statusCode: 200 };
        }
        await postMessage(event.channel, openaiResponse, threadTs, context);
        context.log('ChatGPTBot function post message successfully.');
      }
      return { statusCode: 200 };
    } catch (error) {
      context.log(
        await postMessage(
          event.channel,
          `Error happened: ${error}`,
          threadTs,
          context
        )
      );
    }
  }
  context.res = {
    status: 200,
  };
};
