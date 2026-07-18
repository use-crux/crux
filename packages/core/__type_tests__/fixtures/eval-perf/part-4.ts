import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval15 = evaluate({
  id: "perf-15",
  task: perfTask,
  cases: [
    {
      id: "case-15-free",
      input: { question: "Question 15", tier: "free", index: 15 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-15-pro",
      input: { question: "Detailed question 15", tier: "pro", index: 15 },
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

export const eval16 = evaluate({
  id: "perf-16",
  task: perfTask,
  cases: [
    {
      id: "case-16-free",
      input: { question: "Question 16", tier: "free", index: 16 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-16-pro",
      input: { question: "Detailed question 16", tier: "pro", index: 16 },
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

export const eval17 = evaluate({
  id: "perf-17",
  task: perfTask,
  cases: [
    {
      id: "case-17-free",
      input: { question: "Question 17", tier: "free", index: 17 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-17-pro",
      input: { question: "Detailed question 17", tier: "pro", index: 17 },
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

export const eval18 = evaluate({
  id: "perf-18",
  task: perfTask,
  cases: [
    {
      id: "case-18-free",
      input: { question: "Question 18", tier: "free", index: 18 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-18-pro",
      input: { question: "Detailed question 18", tier: "pro", index: 18 },
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

export const eval19 = evaluate({
  id: "perf-19",
  task: perfTask,
  cases: [
    {
      id: "case-19-free",
      input: { question: "Question 19", tier: "free", index: 19 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-19-pro",
      input: { question: "Detailed question 19", tier: "pro", index: 19 },
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
