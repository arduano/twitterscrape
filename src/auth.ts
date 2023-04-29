import puppeteer, { Protocol } from "puppeteer";
import { getAuthConfig, saveAuthConfig } from "./files";

export type TwitterSession = {
  cookies: Protocol.Network.Cookie[];
};

export async function createAuth(): Promise<TwitterSession> {
  const browser = await puppeteer.launch({ headless: false });

  const page = await browser.newPage();

  await page.goto("https://twitter.com");

  console.log("Waiting for user to login...");
  console.log("Press enter to continue");

  while (true) {
    const cookies = await page.cookies();
    const session: TwitterSession = {
      cookies,
    };

    if (isSessionValid(session)) {
      await browser.close();
      return session;
    } else {
      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export function isSessionValid(session: TwitterSession) {
  let authCookie = session.cookies.find((c) => c.name == "auth_token");
  let ct0Cookie = session.cookies.find((c) => c.name == "ct0");

  // Check if the cookies exist
  if (!authCookie || !ct0Cookie) {
    return false;
  }

  // Check the cookies' "expired" dates
  let now = Date.now() / 1000;
  if (authCookie.expires! < now || ct0Cookie.expires! < now) {
    return false;
  }

  return true;
}

export async function getOrCreateAuth(): Promise<TwitterSession> {
  let currentAuth = await getAuthConfig();
  if (currentAuth) {
    if (isSessionValid(currentAuth)) {
      return currentAuth;
    } else {
      console.log("Existing auth is no longer valid");
    }
  } else {
    console.log("No existing auth found");
  }

  let newAuth = await createAuth();

  if (!isSessionValid(newAuth)) {
    console.error("Failed to create a valid auth, did you log in?");
    throw new Error("Failed to create a valid auth, did you log in?");
  }

  await saveAuthConfig(newAuth);
  return newAuth;
}
