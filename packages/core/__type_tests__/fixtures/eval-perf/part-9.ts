import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval40 = evaluate({
  id: "perf-40",
  task: perfTask,
  cases: [
    {
      id: "case-40-free",
      input: { question: "Question 40", tier: "free", index: 40 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-40-pro",
      input: { question: "Detailed question 40", tier: "pro", index: 40 },
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

export const eval41 = evaluate({
  id: "perf-41",
  task: perfTask,
  cases: [
    {
      id: "case-41-free",
      input: { question: "Question 41", tier: "free", index: 41 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-41-pro",
      input: { question: "Detailed question 41", tier: "pro", index: 41 },
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

export const eval42 = evaluate({
  id: "perf-42",
  task: perfTask,
  cases: [
    {
      id: "case-42-free",
      input: { question: "Question 42", tier: "free", index: 42 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-42-pro",
      input: { question: "Detailed question 42", tier: "pro", index: 42 },
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

export const eval43 = evaluate({
  id: "perf-43",
  task: perfTask,
  cases: [
    {
      id: "case-43-free",
      input: { question: "Question 43", tier: "free", index: 43 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-43-pro",
      input: { question: "Detailed question 43", tier: "pro", index: 43 },
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

export const eval44 = evaluate({
  id: "perf-44",
  task: perfTask,
  cases: [
    {
      id: "case-44-free",
      input: { question: "Question 44", tier: "free", index: 44 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-44-pro",
      input: { question: "Detailed question 44", tier: "pro", index: 44 },
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
