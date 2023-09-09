import puppeteer from "puppeteer";
import { isTruthy } from "./util";
import { TwitterSession } from "./auth";

function warnMissing(message: string) {
  console.warn(
    `WARNING: ${message} is missing from a tweet, possibly the API changed`
  );
}

export type TweetData = NonNullable<ReturnType<typeof getTweetData>>;
function getTweetData(tweet: any) {
  let result = tweet?.content?.itemContent?.tweet_results?.result;

  if (!result) {
    return null;
  }

  if (result.__typename === "TweetWithVisibilityResults") {
    result = result.tweet;
  } else if (result.__typename !== "Tweet") {
    return null;
  }

  let created = result?.legacy?.created_at;
  let tweetId = result?.legacy?.id_str || result?.legacy?.conversation_id_str;
  let entities = result?.legacy?.extended_entities || result?.legacy?.entities;

  let media = entities?.media;

  if (!tweetId) {
    warnMissing("tweet id");
    return null;
  }

  if (!created) {
    warnMissing("created time");
    return null;
  }

  if (!media) {
    media = [];
  }

  let photoMedia = media.filter((m: any) => m.type == "photo");
  let photoUrls = photoMedia.map((m: any) => m.media_url_https);

  for (let url of photoUrls) {
    if (!url) {
      warnMissing("media url");
      return null;
    }
  }

  return {
    tweetId: tweetId as string,
    created: new Date(created),
    photoUrls: photoUrls as string[],
  };
}

export async function getTweetStream(pageUrl: string, auth: TwitterSession) {
  const browser = await puppeteer.launch({ headless: false });

  const page = await browser.newPage();
  await page.setCookie(...auth.cookies);

  await page.setRequestInterception(true);

  const foundTweets: TweetData[] = [];
  let addTweetsResolver = () => {};
  let resolverPromise = new Promise<void>((resolve) => {
    addTweetsResolver = resolve;
  });

  page.on("request", async (r) => {
    await r.continue();
  });

  page.on("requestfinished", async (r) => {
    let url = r.url();
    let userUrlRegex = /.+\/i\/api\/graphql\/[\-\w]+\/User/;
    if (!userUrlRegex.test(url)) {
      return;
    }
    let data = await r.response()?.json();
    let innerData: any[] | undefined =
      data?.data?.user?.result?.timeline_v2?.timeline?.instructions;
    if (!innerData) {
      return;
    }

    let addedEntries = innerData.flatMap((entry) => {
      if (entry.type == "TimelineAddEntries") {
        return entry.entries;
      } else {
        return [];
      }
    });

    let tweetData = addedEntries.map(getTweetData).filter(isTruthy);

    foundTweets.push(...tweetData);
    addTweetsResolver();
  });

  const scrollToBottomTweet = async () => {
    await page.evaluate(async () => {
      let prevElem: any | null = null;

      let intervals = [10, 50, 100];
      let intervalIndex = 0;

      while (true) {
        // Try to dismiss the dialog
        let dialog = document.querySelectorAll('[data-testid="sheetDialog"]');
        if (dialog.length > 0) {
          let dialogElem = dialog.item(0);

          dialogElem
            .querySelectorAll('[data-testid="app-bar-close"]')
            .forEach((elem) => {
              (elem as any).click();
            });
        }

        let elems = document.querySelectorAll(
          'section div[data-testid="cellInnerDiv"]'
        );
        let lastElem = elems.item(elems.length - 1);
        if (!lastElem) {
          console.error(
            "Failed to find last element, possibly the page hasn't loaded yet"
          );
          break;
        }

        // Check if we've found any new tweets. This scroll is only needed to force load more tweets.
        // if (foundTweets.length > 0) {
        //   break;
        // }

        if (prevElem === lastElem) {
          // Scrolling hasn't loaded more tweets, either increase the wait interval or break
          if (intervalIndex < intervals.length - 1) {
            // If there's still more intervals to attempt waiting, then increment the interval
            intervalIndex++;
          } else {
            // If we've reached the last interval value, then we break
            break;
          }
        } else {
          // Scrolling successful, reset the interval
          intervalIndex = 0;
          prevElem = lastElem;

          // Scroll to the last element
          lastElem.scrollIntoView();
        }

        await new Promise((resolve) =>
          setTimeout(resolve, intervals[intervalIndex])
        );
      }
    });
  };

  await page.goto(pageUrl);

  let successfullyStartedTweetFeed = await Promise.race([
    resolverPromise.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 10000);
    }),
  ]);

  // Wait for the page to load
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (!successfullyStartedTweetFeed) {
    console.error("Failed to start tweet feed");
    await browser.close();
    return;
  }

  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await browser.close();
    }
  };

  const tweetsGenertator = async function* () {
    while (true) {
      if (foundTweets.length > 0) {
        yield foundTweets.shift()!;
      } else {
        resolverPromise = new Promise<void>((resolve) => {
          addTweetsResolver = resolve;
        });

        for (let i = 0; i < 3; i++) {
          await scrollToBottomTweet();
          let resolved = await Promise.race([
            resolverPromise.then(() => true),
            new Promise<boolean>((resolve) => {
              setTimeout(() => {
                resolve(false);
              }, 5000);
            }),
          ]);

          if (foundTweets.length > 0) {
            break;
          }

          if (resolved) {
            resolverPromise = new Promise<void>((resolve) => {
              addTweetsResolver = resolve;
            });
          }

          console.log(
            `Waiting longer than usual for tweets to load... ${i + 1}/3`
          );
        }

        if (foundTweets.length == 0) {
          console.log("No more tweets found, exiting");
          break;
        }
      }
    }

    await close();
  };

  return {
    tweetStream: tweetsGenertator(),
    close,
  };
}
