import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval20 = evaluate({
  id: "perf-20",
  task: perfTask,
  cases: [
    {
      id: "case-20-free",
      input: { question: "Question 20", tier: "free", index: 20 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-20-pro",
      input: { question: "Detailed question 20", tier: "pro", index: 20 },
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

export const eval21 = evaluate({
  id: "perf-21",
  task: perfTask,
  cases: [
    {
      id: "case-21-free",
      input: { question: "Question 21", tier: "free", index: 21 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-21-pro",
      input: { question: "Detailed question 21", tier: "pro", index: 21 },
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

export const eval22 = evaluate({
  id: "perf-22",
  task: perfTask,
  cases: [
    {
      id: "case-22-free",
      input: { question: "Question 22", tier: "free", index: 22 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-22-pro",
      input: { question: "Detailed question 22", tier: "pro", index: 22 },
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

export const eval23 = evaluate({
  id: "perf-23",
  task: perfTask,
  cases: [
    {
      id: "case-23-free",
      input: { question: "Question 23", tier: "free", index: 23 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-23-pro",
      input: { question: "Detailed question 23", tier: "pro", index: 23 },
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

export const eval24 = evaluate({
  id: "perf-24",
  task: perfTask,
  cases: [
    {
      id: "case-24-free",
      input: { question: "Question 24", tier: "free", index: 24 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-24-pro",
      input: { question: "Detailed question 24", tier: "pro", index: 24 },
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
