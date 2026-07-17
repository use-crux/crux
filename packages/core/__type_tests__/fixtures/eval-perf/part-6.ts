import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval25 = evaluate({
  id: "perf-25",
  task: perfTask,
  cases: [
    {
      id: "case-25-free",
      input: { question: "Question 25", tier: "free", index: 25 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-25-pro",
      input: { question: "Detailed question 25", tier: "pro", index: 25 },
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

export const eval26 = evaluate({
  id: "perf-26",
  task: perfTask,
  cases: [
    {
      id: "case-26-free",
      input: { question: "Question 26", tier: "free", index: 26 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-26-pro",
      input: { question: "Detailed question 26", tier: "pro", index: 26 },
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

export const eval27 = evaluate({
  id: "perf-27",
  task: perfTask,
  cases: [
    {
      id: "case-27-free",
      input: { question: "Question 27", tier: "free", index: 27 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-27-pro",
      input: { question: "Detailed question 27", tier: "pro", index: 27 },
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

export const eval28 = evaluate({
  id: "perf-28",
  task: perfTask,
  cases: [
    {
      id: "case-28-free",
      input: { question: "Question 28", tier: "free", index: 28 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-28-pro",
      input: { question: "Detailed question 28", tier: "pro", index: 28 },
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

export const eval29 = evaluate({
  id: "perf-29",
  task: perfTask,
  cases: [
    {
      id: "case-29-free",
      input: { question: "Question 29", tier: "free", index: 29 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-29-pro",
      input: { question: "Detailed question 29", tier: "pro", index: 29 },
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
