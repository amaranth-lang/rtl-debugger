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

  reg [7:0] index = 0;
  always @(posedge clk)
    if (index < 13)
      index <= index + 1;
    else
      index <= 0;

  assign data = message[index];

endmodule