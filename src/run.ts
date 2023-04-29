import puppeteer from "puppeteer";
import { TweetData, getTweetStream } from "./scrape";
import fs from "fs";
import path from "path";
import { isTruthy } from "./util";
import {
  downloadAllImages,
  getFolderMetadata,
  getFoldersList,
  saveFolderMetadata,
} from "./files";
import { createAuth, getOrCreateAuth } from "./auth";

async function run() {
  const auth = await getOrCreateAuth();

  const folders = await getFoldersList();
  console.log(folders);

  let tweetLists: Record<string, TweetData[]> = {};

  for (let folder of folders) {
    let pageUrl = `https://twitter.com/${folder}/media`;

    console.log(`Getting tweet stream for ${folder}`);

    let tweetSteamData = await getTweetStream(pageUrl, auth);
    if (!tweetSteamData) {
      console.log(`Failed to get tweet stream data for ${folder}`);
      continue;
    }
    let { tweetStream, close } = tweetSteamData;

    let previousTweetData = await getFolderMetadata(folder);
    let tweetIdsSet = new Set(previousTweetData.tweetIds);

    let tweets: TweetData[] = [];

    for await (let tweet of tweetStream) {
      if (tweetIdsSet.has(tweet.tweetId)) {
        console.log(
          `Reached previous tweet ${tweet.tweetId} for ${folder}, stopping`
        );
        break;
      }
      tweets.push(tweet);
    }

    await close();

    tweetLists[folder] = tweets;
  }

  console.log(`Finished scraping, saving media`);

  for (let [folder, tweets] of Object.entries(tweetLists)) {
    console.log(`Saving ${tweets.length} tweets for ${folder}`);
    await downloadAllImages(folder, tweets);
    console.log(`Saved!`);

    const newTweetIds = tweets.map((t) => t.tweetId);
    const oldTweetIds = (await getFolderMetadata(folder)).tweetIds;

    const allTweetIds = [...newTweetIds, ...oldTweetIds].filter(isTruthy);
    const uniqueTweetIds = [...new Set(allTweetIds)];

    await saveFolderMetadata(folder, { tweetIds: uniqueTweetIds });
  }
}

run();
