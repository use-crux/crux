import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval5 = evaluate({
  id: "perf-5",
  task: perfTask,
  cases: [
    {
      id: "case-5-free",
      input: { question: "Question 5", tier: "free", index: 5 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-5-pro",
      input: { question: "Detailed question 5", tier: "pro", index: 5 },
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

export const eval6 = evaluate({
  id: "perf-6",
  task: perfTask,
  cases: [
    {
      id: "case-6-free",
      input: { question: "Question 6", tier: "free", index: 6 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-6-pro",
      input: { question: "Detailed question 6", tier: "pro", index: 6 },
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

export const eval7 = evaluate({
  id: "perf-7",
  task: perfTask,
  cases: [
    {
      id: "case-7-free",
      input: { question: "Question 7", tier: "free", index: 7 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-7-pro",
      input: { question: "Detailed question 7", tier: "pro", index: 7 },
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

export const eval8 = evaluate({
  id: "perf-8",
  task: perfTask,
  cases: [
    {
      id: "case-8-free",
      input: { question: "Question 8", tier: "free", index: 8 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-8-pro",
      input: { question: "Detailed question 8", tier: "pro", index: 8 },
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

export const eval9 = evaluate({
  id: "perf-9",
  task: perfTask,
  cases: [
    {
      id: "case-9-free",
      input: { question: "Question 9", tier: "free", index: 9 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-9-pro",
      input: { question: "Detailed question 9", tier: "pro", index: 9 },
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
