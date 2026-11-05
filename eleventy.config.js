import { readFileSync } from 'node:fs';

const site = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'));

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData('site', site);

  // Browser assets are copied as-is: plain ES modules, no bundler (SPEC §5).
  eleventyConfig.addPassthroughCopy({ 'src/css': 'css' });
  eleventyConfig.addPassthroughCopy({ 'src/js': 'js' });
  eleventyConfig.addPassthroughCopy({ media: 'media' });
}

export const config = {
  dir: {
    input: 'content',
    includes: '../src/_includes',
    output: 'dist',
  },
  markdownTemplateEngine: 'njk',
  htmlTemplateEngine: 'njk',
};
