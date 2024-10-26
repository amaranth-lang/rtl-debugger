module counter(
  input clk,
  output reg [31:0] cnt = 0
);

  parameter integer LIMIT = 0;

  always @(posedge clk)
    if (cnt == LIMIT)
      cnt <= 0;
    else
      cnt <= cnt + 1;

endmodule

(* top *)
module top(
  input clk,
  output [7:0] data,
  output [31:0] timer
);

  reg [7:0] message [14];
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

  wire [7:0] message_index;
  counter #(
    .LIMIT(13)
  ) counter_message(
    .clk(clk),
    .cnt(message_index)
  );

  assign data = message[message_index];

  counter #(
    .LIMIT(32'hffffffff)
  ) counter_timer(
    .clk(clk),
    .cnt(timer),
  );

endmodule
