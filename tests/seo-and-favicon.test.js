import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import {
  getPageDescription,
  getPageTitle,
  updateDocumentMeta,
} from "../src/router.js";

test("public favicon and manifest files exist with valid contents", async () => {
  const publicFiles = [
    "favicon.ico",
    "favicon.svg",
    "favicon-32x32.png",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "site.webmanifest",
    "robots.txt",
    "sitemap.xml",
  ];

  for (const file of publicFiles) {
    const url = new URL(`../public/${file}`, import.meta.url);
    await assert.doesNotReject(access(url, constants.R_OK), `Expected public/${file} to exist and be readable`);
  }

  const manifest = JSON.parse(await readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Drizzlearn — AI Learning Workspace");
  assert.equal(manifest.short_name, "Drizzlearn");
  assert.equal(manifest.theme_color, "#0b0b14");
  assert.ok(manifest.icons.length >= 3);

  const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /User-agent:\s*\*/i);
  assert.match(robots, /Allow:\s*\/courses/);
  assert.match(robots, /Disallow:\s*\/api\//);
  assert.match(robots, /Sitemap:\s*\/sitemap\.xml/);

  const sitemap = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  assert.match(sitemap, /<loc>\/courses<\/loc>/);
  assert.match(sitemap, /<loc>\/practice<\/loc>/);
  assert.match(sitemap, /<loc>\/flashcards<\/loc>/);

  const svg = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(svg, /<svg[^>]*viewBox="0 0 64 64"/);
});

test("index.html contains full semantic SEO, OpenGraph, Twitter, and Schema.org structured data", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  // Title and Description
  assert.match(html, /<title>Drizzlearn[^<]*<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*Drizzlearn[^"]*">/);
  assert.match(html, /<meta name="keywords" content="[^"]*spaced repetition[^"]*">/);

  // Favicons & Manifest
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32x32\.png">/);
  assert.match(html, /<link rel="shortcut icon" href="\/favicon\.ico">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="manifest" href="\/site\.webmanifest">/);
  assert.match(html, /<link rel="canonical" href="\/"[^>]*>/);

  // Open Graph
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta property="og:site_name" content="Drizzlearn">/);
  assert.match(html, /<meta property="og:title" content="[^"]*Drizzlearn[^"]*">/);
  assert.match(html, /<meta property="og:description" content="[^"]*Drizzlearn[^"]*">/);
  assert.match(html, /<meta property="og:image" content="\/images\/hero-banner\.png">/);

  // Twitter Card
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta name="twitter:title" content="[^"]*Drizzlearn[^"]*">/);
  assert.match(html, /<meta name="twitter:image" content="\/images\/hero-banner\.png">/);

  // JSON-LD
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"applicationCategory":\s*"EducationalApplication"/);
});

test("updateDocumentMeta synchronizes title, description, and canonical tags dynamically", () => {
  const metas = new Map();
  const mockDoc = {
    title: "",
    querySelector(selector) {
      if (!metas.has(selector)) {
        metas.set(selector, {
          attrs: {},
          setAttribute(k, v) { this.attrs[k] = v; },
          getAttribute(k) { return this.attrs[k]; },
        });
      }
      return metas.get(selector);
    },
  };
  const mockWin = { document: mockDoc };

  updateDocumentMeta("flashcards", { url: "/flashcards", win: mockWin });
  assert.equal(mockDoc.title, getPageTitle("flashcards"));
  assert.equal(mockDoc.querySelector('meta[name="description"]').getAttribute("content"), getPageDescription("flashcards"));
  assert.equal(mockDoc.querySelector('meta[property="og:title"]').getAttribute("content"), getPageTitle("flashcards"));
  assert.equal(mockDoc.querySelector('link[rel="canonical"]').getAttribute("href"), "/flashcards");

  updateDocumentMeta("practice", { url: "/practice", win: mockWin });
  assert.equal(mockDoc.title, getPageTitle("practice"));
  assert.equal(mockDoc.querySelector('meta[name="description"]').getAttribute("content"), getPageDescription("practice"));
  assert.equal(mockDoc.querySelector('link[rel="canonical"]').getAttribute("href"), "/practice");
});
