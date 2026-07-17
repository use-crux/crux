import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval45 = evaluate({
  id: "perf-45",
  task: perfTask,
  cases: [
    {
      id: "case-45-free",
      input: { question: "Question 45", tier: "free", index: 45 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-45-pro",
      input: { question: "Detailed question 45", tier: "pro", index: 45 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval46 = evaluate({
  id: "perf-46",
  task: perfTask,
  cases: [
    {
      id: "case-46-free",
      input: { question: "Question 46", tier: "free", index: 46 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-46-pro",
      input: { question: "Detailed question 46", tier: "pro", index: 46 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval47 = evaluate({
  id: "perf-47",
  task: perfTask,
  cases: [
    {
      id: "case-47-free",
      input: { question: "Question 47", tier: "free", index: 47 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-47-pro",
      input: { question: "Detailed question 47", tier: "pro", index: 47 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval48 = evaluate({
  id: "perf-48",
  task: perfTask,
  cases: [
    {
      id: "case-48-free",
      input: { question: "Question 48", tier: "free", index: 48 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-48-pro",
      input: { question: "Detailed question 48", tier: "pro", index: 48 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval49 = evaluate({
  id: "perf-49",
  task: perfTask,
  cases: [
    {
      id: "case-49-free",
      input: { question: "Question 49", tier: "free", index: 49 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-49-pro",
      input: { question: "Detailed question 49", tier: "pro", index: 49 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});
