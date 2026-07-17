import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval30 = evaluate({
  id: "perf-30",
  task: perfTask,
  cases: [
    {
      id: "case-30-free",
      input: { question: "Question 30", tier: "free", index: 30 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-30-pro",
      input: { question: "Detailed question 30", tier: "pro", index: 30 },
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

export const eval31 = evaluate({
  id: "perf-31",
  task: perfTask,
  cases: [
    {
      id: "case-31-free",
      input: { question: "Question 31", tier: "free", index: 31 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-31-pro",
      input: { question: "Detailed question 31", tier: "pro", index: 31 },
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

export const eval32 = evaluate({
  id: "perf-32",
  task: perfTask,
  cases: [
    {
      id: "case-32-free",
      input: { question: "Question 32", tier: "free", index: 32 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-32-pro",
      input: { question: "Detailed question 32", tier: "pro", index: 32 },
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

export const eval33 = evaluate({
  id: "perf-33",
  task: perfTask,
  cases: [
    {
      id: "case-33-free",
      input: { question: "Question 33", tier: "free", index: 33 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-33-pro",
      input: { question: "Detailed question 33", tier: "pro", index: 33 },
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

export const eval34 = evaluate({
  id: "perf-34",
  task: perfTask,
  cases: [
    {
      id: "case-34-free",
      input: { question: "Question 34", tier: "free", index: 34 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-34-pro",
      input: { question: "Detailed question 34", tier: "pro", index: 34 },
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
