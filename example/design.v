module counter(...);

  input clk;
  output reg [7:0] cnt = 0;
  always @(posedge clk)
    if (cnt < 13)
      cnt <= cnt + 1;
    else
      cnt <= 0;

endmodule

(* top *)
module top(...);

  input clk;
  output [7:0] data;

  reg [7:0] message [0:13];
  initial begin
    message[0] = "h";
    message[1] = "e";
    message[2] = "l";
    message[3] = "l";
    message[4] = "o";
    message[5] = " ";
    message[6] = "w";
    message[7] = "o";
    message[8] = "r";
    message[9] = "l";
    message[10] = "d";
    message[11] = "!";
    message[12] = "\n";
  end

  wire [7:0] index;
  counter counter_inst(
    .clk(clk),
    .cnt(index)
  );

  assign data = message[index];

endmodule
