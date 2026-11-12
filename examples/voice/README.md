# Voice example

A small, working starting point for voice: a web page that talks with a realtime model about one of the families, using your own microphone. Copy it, change it, or just read it to see how the pieces fit. You don't have to use it.

## Run it

You need Node 22 or later, Chrome and your team's AI key (from [your access page](https://mcp-hackathon.sherpaswealth.com/personal-token)).

```bash
cd examples/voice
npm install
cp .env.example .env      # then put your team key in .env
npm start                 # open http://localhost:5173 in Chrome
```

Pick a family and a model, click **Connect**, allow the microphone and start talking. Use headphones.

## How it works

```
browser (mic + speaker)  ⇄  server.mjs (your key, the case)  ⇄  wss://llm-hackathon.sherpaswealth.com/v1/realtime
```

- **`server.mjs`** serves the page and relays WebSocket messages between the page and the AI proxy. Your key never reaches the browser: browsers can't send it as a header, and anyone could copy it from there.
- **The case:** when you pick a family, the server reads `cases/<family>/financial-health.json` and adds a short brief to the model's instructions: the household, the score and the plan's summary and recommendations. Change `caseBrief()` to give the model more, or different, parts of the plan.
- **`public/index.html`** does the rest in the browser: it captures the mic, sends 20 ms of PCM16 audio at 24 kHz in each `input_audio_buffer.append`, plays the `response.output_audio.delta` chunks and shows both transcripts.

All three voice models use the same OpenAI Realtime protocol through the proxy: `gpt-realtime-2.1-mini`, `gpt-realtime-2.1` and `gemini-3.8-live`. Switching is just the `?model=`. (`gpt-live-1` uses a different protocol and isn't covered here.)

## Things worth knowing

- **Turns.** In open-mic mode the server decides when you've finished talking. `server_vad` waits for a silence (500 ms by default). `semantic_vad`, OpenAI only, waits until you seem to have finished the thought, which works better if you pause while you speak. In push-to-talk mode the page sends `input_audio_buffer.commit` when you release the button.
- **Interruptions.** When you talk over the model, stop its audio. The model sends a reply much faster than it plays, so by then most of the reply has already arrived: drop everything that's queued.
  - OpenAI sends `input_audio_buffer.speech_started`. The page also sends `conversation.item.truncate`, so the model knows how much you actually heard.
  - Gemini ends the cut reply with a `response.done` that has no `response.output_audio.done` before it.
- **A reply with text but no sound** is a reply that was cut. The bubble says when and why. If the interruption had no words, it was noise or the speaker's echo: use headphones.
- **Cost.** Voice is billed per session, against your team's $50. Hang up when you're done.

## Making it yours

This is a test bench, not a product. For your project you'd typically keep the relay in `server.mjs` (or rewrite it in your backend's language: it's about 40 lines), and replace the page with your own experience.
