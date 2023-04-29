import fs from "fs";
import path from "path";
import { isTruthy } from "./util";
import PromisePool from "@supercharge/promise-pool/dist";
import { TweetData } from "./scrape";
import { TwitterSession } from "./auth";

const foldersPath = "./scraped";

export async function getAuthConfig() {
  let configPath = path.join(foldersPath, "./auth.json");
  try {
    let contents = await fs.promises.readFile(configPath, "utf8");
    return JSON.parse(contents) as TwitterSession;
  } catch {
    return null;
  }
}

export async function saveAuthConfig(config: TwitterSession) {
  await ensureFolderExists(foldersPath);
  let configPath = path.join(foldersPath, "./auth.json");
  await fs.promises.writeFile(configPath, JSON.stringify(config), "utf8");
}

export async function getFoldersList() {
  let items: string[];
  try {
    items = await fs.promises.readdir(foldersPath);
  } catch {
    return [];
  }

  let folders = await Promise.all(
    items.map(async (item) => {
      let itemPath = path.join(foldersPath, item);
      let stat = await fs.promises.stat(itemPath);
      if (stat.isDirectory()) {
        return item;
      }
    })
  );

  return folders.filter(isTruthy);
}

export async function ensureFolderExists(path: string) {
  try {
    await fs.promises.mkdir(path, { recursive: true });
  } catch (e) {
    if ((e as any).code !== "EEXIST") {
      throw e;
    }
  }
}

type FolderMetadata = {
  tweetIds: string[];
};

export async function getFolderMetadata(
  folder: string
): Promise<FolderMetadata> {
  const filePath = path.join(foldersPath, `${folder}.txt`);

  try {
    const contents = await fs.promises.readFile(filePath, "utf8");
    const ids = contents
      .split("\n")
      .map((line) => line.trim())
      .filter((l) => l != "");
    return { tweetIds: ids };
  } catch (e) {
    return { tweetIds: [] };
  }
}

export async function saveFolderMetadata(
  folder: string,
  tweetIds: FolderMetadata
) {
  await ensureFolderExists(foldersPath);
  const filePath = path.join(foldersPath, `${folder}.txt`);

  const contents = tweetIds.tweetIds.join("\n");

  await fs.promises.writeFile(filePath, contents, "utf8");
}

export async function downloadAllImages(folder: string, tweets: TweetData[]) {
  const folderPath = path.join(foldersPath, folder);
  await ensureFolderExists(folderPath);

  await PromisePool.withConcurrency(2)
    .for(tweets)
    .withConcurrency(10)
    .process(async (tweet, index, pool) => {
      let imageUrls = tweet.photoUrls;

      for (let url of imageUrls) {
        let split = url.split("/");
        let filename = split[split.length - 1];

        try {
          const response = await fetch(url);
          const buffer = await response.arrayBuffer();
          let filepath = path.join(
            folderPath,
            `${tweet.created.getTime()}_${filename}`
          );
          await fs.promises.writeFile(filepath, Buffer.from(buffer));
        } catch (e) {
          console.error(e);
        }
      }
    });
}
