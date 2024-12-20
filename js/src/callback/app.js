import yaml from 'js-yaml';
import crypto from 'crypto';
import { retrieveScore } from './api.js';

const DEFENDER_URL = process.env.DEFENDER_URL;
const PROMPT_DEFENDER_CONFIG_PATH = '.github/prompt-defender.yml';
const PROMPT_DEFENCE_CHECK_NAME = 'Prompt Defence check';
const PROMPT_DEFENCE_CHECK_TITLE = 'Checking prompts';
const PROMPT_DEFENCE_CHECK_SUMMARY = 'Checking prompts for security vulnerabilities';
const PROMPT_DEFENCE_CHECK_TEXT = 'Checking prompts for security vulnerabilities';

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */

async function loadConfig(context, branchName) {
  const { data: fileContent } = await context.octokit.repos.getContent({
    owner: context.repo().owner,
    repo: context.repo().repo,
    path: PROMPT_DEFENDER_CONFIG_PATH,
    ref: branchName,
  });

  const content = Buffer.from(fileContent.content, 'base64').toString();
  const config = yaml.load(content);
  return config;
}

function handleConfigFileChange(app, config) {
  app.log.info('Config file has changed getting all prompt files');
  return config.prompts.map(prompt => {
    return {
      filename: prompt,
      status: 'modified',
    };
  });
}

const postSuccessStatus = async (context, pullRequest) => {
  await context.octokit.checks.create({
    owner: context.repo().owner,
    repo: context.repo().repo,
    name: PROMPT_DEFENCE_CHECK_NAME,
    head_sha: pullRequest.head.sha,
    status: 'completed',
    conclusion: 'success',
    output: {
      title: 'Checks Passed',
      summary: 'No prompt files have changed.',
      text: 'No prompt files have been changed.',
    },
  });
};

// Post a 'starting' status to the PR
const postStartingStatus = async (context, pullRequest) => {
  return await context.octokit.checks.create({
    owner: context.repo().owner,
    repo: context.repo().repo,
    name: PROMPT_DEFENCE_CHECK_NAME,
    head_sha: pullRequest.head.sha,
    status: 'in_progress',
    output: {
      title: PROMPT_DEFENCE_CHECK_TITLE,
      summary: PROMPT_DEFENCE_CHECK_SUMMARY,
      text: PROMPT_DEFENCE_CHECK_TEXT,
    },
  });
};

export default (app) => {
  app.on(['pull_request.opened', 'pull_request.synchronize'], async (context) => {
    const pullRequest = context.payload.pull_request;
    const branchName = pullRequest.head.ref;

    const config = await loadConfig(context, branchName);

    const files = await retrievePullRequestFiles(context, pullRequest);
    let promptFiles = retrievePromptsFromFiles(files, config);

    const changedFiles = files.data.map(file => file.filename);

    if (changedFiles.includes(PROMPT_DEFENDER_CONFIG_PATH)) {
      promptFiles = handleConfigFileChange(app, config);
    }

    app.log.info(`Files changed: ${files.data.map(file => file.filename)}`);
    app.log.info(`Prompt files: ${promptFiles.map(file => file.filename)}`);

    if (promptFiles.length === 0) {
      await postSuccessStatus(context, pullRequest);
      return;
    }

    const statusCreated = await postStartingStatus(context, pullRequest);
    app.log.info(`Responses: ${JSON.stringify(statusCreated, null, 2)}`);

    const responses = [];

    for (const file of promptFiles) {

      app.log.info(`Checking file ${file.filename}`);

      if (file.status === 'removed') {
        app.log.info(`File ${file.filename} has been removed. Skipping.`);
        continue;
      }

      const { data: fileContent } = await context.octokit.repos.getContent({
        owner: context.repo().owner,
        repo: context.repo().repo,
        path: file.filename,
        ref: branchName,
      });

      const prompt = Buffer.from(fileContent.content, 'base64').toString();

      const response = await retrieveScore(prompt);
      app.log.info(`Prompt score: ${response.score}`);

      responses.push({
        file: file.filename,
        score: response.score,
        explanation: response.explanation,
        hash: crypto.createHash('sha256').update(prompt).digest('hex'),
        passOrFail: response.score >= config.threshold ? 'pass' : 'fail',
      });
    }

    await processResults(app, context, pullRequest, config.threshold, responses, statusCreated.data.id);

  });
};

async function processResults(app, context, pullRequest, threshold, responses, statusId) {

  if (!statusId) {
    app.log.error('Status ID is not defined. Exiting processResults.');
    return;
  }

  const failedChecks = responses.filter(response => response.passOrFail === 'fail').length;

  let conclusion = 'success';
  if (failedChecks > 0) {
    conclusion = 'failure';
  }

  const summary = responses.map(response => {
    const badge = response.passOrFail === 'pass' ? '![Pass](https://img.shields.io/badge/Status-Pass-green)' : '![Fail](https://img.shields.io/badge/Status-Fail-red)';
    return `
    ## Prompt Defence - ${response.passOrFail.toUpperCase()} ${badge}
    Threshold is set to ${threshold}\n
    ### File: ${response.file}
    - **Score**: ${response.score}
    - **Explanation**: ${response.explanation}
    - **Pass/Fail**: ${response.passOrFail} 
    - [Prompt Defence - test results](https://pdappservice.azurewebsites.net/score/${response.hash})
    `;
  }).join('\n\n'); // Ensure each section is separated by an empty line

  try {
    await context.octokit.checks.update({
      owner: context.repo().owner,
      repo: context.repo().repo,
      check_run_id: statusId,
      status: 'completed',
      conclusion: conclusion,
      details_url: `https://pdappservice.azurewebsites.net/score/${pullRequest.head.sha}`,
      output: {
        title: 'Checks Complete',
        summary: (failedChecks > 0) ? 'One or more checks have failed.' : 'All checks have passed.',
        text: summary,
      },
    });
  } catch (error) {
    context.log.error('Failed to update check run:', error);
    throw error;
  }
}

function retrievePromptsFromFiles(files, config) {
  return files.data.filter((file) => config.prompts.includes(file.filename));
}

async function retrievePullRequestFiles(context, pullRequest) {
  return await context.octokit.pulls.listFiles({
    owner: context.repo().owner,
    repo: context.repo().repo,
    pull_number: pullRequest.number,
  });
}