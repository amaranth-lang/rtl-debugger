#include "design.h"
#include <cxxrtl/cxxrtl_vcd.h>
#include <cxxrtl/cxxrtl_time.h>
#include <cxxrtl/cxxrtl_replay.h>
#include <cxxrtl/cxxrtl_server.h>

using namespace cxxrtl::time_literals;

int main(int argc, char **argv) {
  if (argc != 1) {
    fprintf(stderr, "Usage: %s\n", argv[0]);
    return 1;
  }

  cxxrtl::spool spool("spool.bin");
  cxxrtl::agent<cxxrtl::tcp_link, cxxrtl_design::p_top> agent(spool);

  agent.step();
  fprintf(stderr, "Simulation started on cxxrtl+tcp://localhost:6618\n");

  size_t steps = 0;
  auto &top = agent.get_toplevel();
  while (true) {
    agent.advance(1_ns);
    top.p_clk.set(false);
    agent.step();

    agent.advance(1_ns);
    top.p_clk.set(true);
    agent.step();
  }

  return 0;
}