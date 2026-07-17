import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval0 = evaluate({
  id: "perf-0",
  task: perfTask,
  cases: [
    {
      id: "case-0-free",
      input: { question: "Question 0", tier: "free", index: 0 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-0-pro",
      input: { question: "Detailed question 0", tier: "pro", index: 0 },
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

export const eval1 = evaluate({
  id: "perf-1",
  task: perfTask,
  cases: [
    {
      id: "case-1-free",
      input: { question: "Question 1", tier: "free", index: 1 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-1-pro",
      input: { question: "Detailed question 1", tier: "pro", index: 1 },
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

export const eval2 = evaluate({
  id: "perf-2",
  task: perfTask,
  cases: [
    {
      id: "case-2-free",
      input: { question: "Question 2", tier: "free", index: 2 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-2-pro",
      input: { question: "Detailed question 2", tier: "pro", index: 2 },
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

export const eval3 = evaluate({
  id: "perf-3",
  task: perfTask,
  cases: [
    {
      id: "case-3-free",
      input: { question: "Question 3", tier: "free", index: 3 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-3-pro",
      input: { question: "Detailed question 3", tier: "pro", index: 3 },
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

export const eval4 = evaluate({
  id: "perf-4",
  task: perfTask,
  cases: [
    {
      id: "case-4-free",
      input: { question: "Question 4", tier: "free", index: 4 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-4-pro",
      input: { question: "Detailed question 4", tier: "pro", index: 4 },
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
