export async function readSseStream(response, { onChunk, onDone, onError } = {}) {
  if (!response.body) {
    throw new Error('Streaming response body is not available.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const payload = line.slice(6).trim();
        if (!payload) continue;

        if (payload === '[DONE]') {
          onDone?.({});
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          if (parsed?.type === 'chunk') {
            onChunk?.(parsed.text || '');
          } else if (parsed?.type === 'done') {
            onDone?.({
              conversationId: parsed.conversationId || null,
              sources: Array.isArray(parsed.sources) ? parsed.sources : [],
              confidence: parsed.confidence || null,
            });
          } else if (parsed?.type === 'error') {
            const error = new Error(parsed.message || 'Stream error');
            onError?.(error);
            throw error;
          } else if (parsed?.text) {
            onChunk?.(parsed.text);
          }
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }

    onDone?.({});
  } catch (error) {
    onError?.(error);
  } finally {
    reader.releaseLock();
  }
}
