import { getOrCreateAuth } from "./auth";
import { getAuthConfig } from "./files";
import { getTweetStream } from "./scrape";

async function run() {
  const auth = await getOrCreateAuth();
  const data = await getTweetStream("https://twitter.com/pofu31/media", auth);

  if (!data) {
    console.log("No data");
    return null;
  }

  for await (const tweet of data.tweetStream) {
    console.log(tweet);
  }
}

run();
