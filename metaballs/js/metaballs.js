// Shaders-----------

function getVertexShader() {
  return`
    precision mediump float;

    attribute vec2 vertexPos;

    void main()
    {
      gl_Position = vec4(vertexPos, 0.0, 1.0);
    }
  `;
}

function getFragmentShader() {     
  return `
precision mediump float;

#define NR_OF_METABALLS 5

// The threshold charge for a meta surface
#define TRESHOLD 0.9

// A small number that you want to use to decide if the ray is close enough to surface
#define EPSILON 0.0000001

// How many steps of marching
#define MARCHING_STEPS 1000

uniform mat4 invView;
uniform mat4 invProj;
uniform vec4 ray00;
uniform vec4 ray01;
uniform vec4 ray10;
uniform vec4 ray11;
uniform vec3 u_CamPos;
uniform vec4 u_Metaballs;
uniform vec2 res;

// point light
uniform vec3 light;

uniform vec4 metaballs[NR_OF_METABALLS];
uniform vec3 diffuseColors[NR_OF_METABALLS];

struct Ray
{
  vec3 origin;
  vec3 direction;
  vec3 currPos;
  float depth;
};

struct Material
{
  vec3 diffuse;
  float reflectance;
};

struct Hit
{
  vec3 position;
  vec3 normal;
  float t;
  Material material;
};

struct Blob
{
  // coords + radius
  vec3 center;
  float radius;
  Material material;
};

Ray initRay()
{
  vec2 pos = vec2(gl_FragCoord.xy);
  vec2 interp = pos / res;

  vec4 rayDirection = mix(
      mix(ray00, ray01, interp.y), // left corners together
      mix(ray10, ray11, interp.y), // right corners together
      interp.x // join new interpolated rays into a final ray
  );
  rayDirection = vec4(rayDirection.xyz, 1.0);
  rayDirection = normalize(rayDirection);

  Ray r;
  r.origin = -u_CamPos;
  r.direction = rayDirection.xyz;
  return r;
}

Blob blobs[NR_OF_METABALLS];

// initializes the scene
void initScene()
{
  for (int i = 0; i < NR_OF_METABALLS; i++)
  {
    // set the center, radius and material of the blobs
    blobs[i].center = vec3(vec4(metaballs[i].xyz, 1.0));
    blobs[i].radius = metaballs[i].r;
    blobs[i].material.diffuse = diffuseColors[i];
    blobs[i].material.reflectance = 0.2;
  }
}

float sdMetaBalls( vec3 pos, out int hitIndex )
{
    float m = 0.0;
    float p = 0.0;
    float dmin = 1e20;
    int counter = 0;
    float h = 1.0; // track Lipschitz constant
    for( int i = 0; i < NR_OF_METABALLS; i++ )
    {
        /* Bounding sphere for ball */

        // distance between current ray and current blob
        float db = length( blobs[i].center - pos );

        // if the distance is shorter than current blob's radius
        if( db < blobs[i].radius )
        {
            float x = db / blobs[i].radius;
            p += 1.0 - x * x * x * ( x * (x * 6.0 - 15.0) + 10.0);
            m += 1.0;
            float h = max(h, 0.133 * blobs[i].radius);
            counter++;
         }
         /* Bouncing sphere distance */
         else
         {
           // the ray is still out of current blob's boundary
           // update dmin with the closest distance between current ray and the surface of blobs
           //dmin = min(dmin, db - blobs[i].radius);
           dmin = db - blobs[i].radius;
         }
     }
     hitIndex = counter;

     // add just big enough to push the ray into the blob when the ray hit the bounding sphere.
     float d = dmin + 0.1;
     if(m > 0.5)
     {
         d = h * (TRESHOLD - p);
     }

     // return the updated distance for the next marching step
     return d;
}

// Distance Field function. it's also called Distance Map or Distance Transform
float map( in vec3 p , out int hitIndex)
{
  return sdMetaBalls( p, hitIndex );
}

vec3 calcNormal( in vec3 pos , out int hitIndex)
{
  vec3 eps = vec3(TRESHOLD, 0.0, 0.0);
  return normalize(vec3(
       map(pos + eps.xyy, hitIndex) - map(pos - eps.xyy, hitIndex),
       map(pos + eps.yxy, hitIndex) - map(pos - eps.yxy, hitIndex),
       map(pos + eps.yyx, hitIndex) - map(pos - eps.yyx, hitIndex)
  ));
}

vec2 intersect( in vec3 ro, in vec3 rd, out int hitIndex )
{
  // Maximum distance - if the ray go further than this, we'll assume there's nothing
  float maxd = 1000.0;

  // Marching step size from the distance field - the closest distance between the current ray position and surface
  float h = EPSILON * 2.0;

  // Total travel distance of the ray - the distance between ray origin and surface
  float t = 0.0;

  // How many steps of marching - the more you iterate, the more precision you will have. But also the more computation cost.
  for(int i = 0; i < MARCHING_STEPS; i++)
  {
      // When the ray is close enough to the surface or the total travel distance is bigger than maximum distance then break the loop
      if( h < EPSILON || t > maxd ) break;

      // Update the total travel distance with the updated marching distance from previous loop
      t += h;

      // Update the marching distance from the distance field
      // ro + rd * t - current position of your ray
      // map(ray) - return the closest distance between the ray and the the scene
      h = map( ro + rd * t, hitIndex );
  }

  // Tells whether the ray is out of the max or not
  float m = 1.0;

  // update m if the ray travels further than the maximum distance. This value will be used to decide whether we render background or metaball in this example
  if( t > maxd )
  {
      m = -1.0;
  }

  return vec2(t, m);
}

vec3 colorForIntersection(in vec3 rd, in vec3 pos, in vec3 normal, in vec3 light_pos, in vec3 color)
{
	vec3 light_dir = normalize(light_pos + pos);
	float shininess = 15.0;
	float lambertian = max(dot(light_dir, normal), 0.0);
	float specular = 0.0;

	if (lambertian > 0.0)
    {
		vec3 refl_dir = reflect(-light_dir, normal);
		float spec_angle = max(dot(refl_dir, -rd), 0.0);
		specular = pow(spec_angle, shininess/4.0);
	}

	return lambertian * color + specular;
}

void main()
{
  // create the primary ray
  Ray ray = initRay();
  vec3 ro = ray.origin;
  vec3 rd = ray.direction;

  // create the scene
  initScene();

  // background
  vec3 backgroundColor = vec3(0.0, 0.0, 0.0);
  vec3 final_color = vec3(0);

  // raymarch
  int hitIndex = 0;
  vec2 hit = intersect(ro, rd, hitIndex);

  // coloring
  if(hit.y > -1.0)
  {
    vec3 pos = ro + hit.x * rd;
    vec3 nor = calcNormal(pos, hitIndex);
    vec3 color;

    if (hitIndex == 0)
    {
        color = blobs[0].material.diffuse;
    }
    else if (hitIndex == 1)
    {
        color = blobs[1].material.diffuse;
    }
    else if (hitIndex == 2)
    {
        color = blobs[2].material.diffuse;
    }
    else if (hitIndex == 3)
    {
        color = blobs[3].material.diffuse;
    }
    else if (hitIndex == 4)
    {
        color = blobs[4].material.diffuse;
    }
    else
    {
        color = vec3(0.2, 0.2, 0.2);
    }

	final_color = colorForIntersection(rd, pos, nor, light, color);
  }
  else
  {
    final_color = backgroundColor;
  }

  gl_FragColor = vec4(final_color, 1.0);
}
`
}

function radToDeg(r)
{
    return r * 180 / Math.PI;
}

function degToRad(d)
{
    return d * (Math.PI / 180);
}

// Generate random number
var seed = 1;
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random(seed++) * (max - min + 1)) + min; //The maximum is inclusive and the minimum is inclusive
}

function createShader(gl, type, source) 
{
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) {
    return shader;
  }
 
  console.log(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
}

function createProgram(gl, vertexShader, fragmentShader) 
{
  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  var success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (success) {
    return program;
  }
 
  console.log(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
}

// Initialize a shader program
function initShaderProgram(gl, vertexShader, fragmentShader)
{
  // Create the shader program
  var shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  // If creating the shader program failed, alert
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS))
  {
    alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    return;
  }

  return shaderProgram;
}

// Creates a shader of the given type, uploads the source and compiles it.
function loadShader(gl, type, source)
{
  const shader = gl.createShader(type);

  // Send the source to the shader object
  gl.shaderSource(shader, source);

  // Compile the shader program
  gl.compileShader(shader);

  // See if it compiled successfully
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
  {
    alert('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return;
  }

  return shader;
}

// Initialize
function init()
{
	var canvas = document.getElementById("world");
	var gl = canvas.getContext("webgl");

	// For unsupported browsers
	if (!gl)
	{
		console.log('WebGL not supported');
		alert('Your browser does not support WebGL');
		return;
	}

	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	//gl.enable(gl.DEPTH_TEST);

	return gl;
}

// Rectangle with vertices
function createQuad(gl)
{
    var data = {
        usage: gl.STATIC_DRAW,
        mode: gl.TRIANGLES,
        n: 6,
        vertex: new Float32Array([
          -1.0, -1.0,
           1.0, -1.0,
          -1.0,  1.0,
          -1.0,  1.0,
           1.0, -1.0,
           1.0,  1.0
        ]),
    };

    return data;
}

// Random metaballs
var metaballs = [];
var nrOfMetaballs = 5;
var higherSpawnArea = 50.0;
var lowerSpawnArea = 30.0;
var metaballDir = 1.0;
var metaData = new Float32Array(4 * nrOfMetaballs);
var colorData = new Float32Array(3 * nrOfMetaballs);
for (var i = 0; i < nrOfMetaballs; i++)
{
  var radius = getRandomInt(1, 10);
  metaballs.push(
  {
    // Metaballs data
    x: getRandomInt(lowerSpawnArea, higherSpawnArea),
    y: getRandomInt(lowerSpawnArea, higherSpawnArea),
    z: getRandomInt(lowerSpawnArea, higherSpawnArea),
    r: radius,

    // Metaballs information
    randDirX: getRandomInt(-metaballDir, metaballDir),
    randDirY: getRandomInt(-metaballDir, metaballDir),
    randDirZ: getRandomInt(-metaballDir, metaballDir),
  });

  // Metaballs color data
  var baseIndex = 3 * i;
  colorData[0 + baseIndex] = getRandomInt(0, 100) / 100.0;
  colorData[1 + baseIndex] = getRandomInt(0, 100) / 100.0;
  colorData[2 + baseIndex] = getRandomInt(0, 100) / 100.0;
}

// Pointlight
var lightPosition = new Float32Array([0.0, 0.0, 0.0]);

function main()
{
	var gl = init();
  
  var vertexShader = createShader(gl,  gl.VERTEX_SHADER, getVertexShader());
  var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, getFragmentShader());
  var program = createProgram(gl, vertexShader, fragmentShader);

	var eyeVec = new Float32Array([-43.0, -42.0, -110.0]);
	var dirVec = new Float32Array([0.0, 0.0, -1.0]);
	var upVec = new Float32Array([0.0, 1.0, 0.0]);

  // Compute the camera's matrix using look at.
  var cameraMatrix = m4.lookAt(eyeVec, dirVec, upVec);

  var aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
  var zNear = 0.00001;
  var zFar = 10000;
  var fov = 110;
  var fieldOfViewRadians = degToRad(fov);

  var projMatrix = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);
  var invProjMatrix = m4.inverse(projMatrix)

  // Make a view matrix from the camera matrix.
  var viewMatrix = m4.inverse(cameraMatrix);

  // Compute a view projection matrix
  var viewProjMatrix = m4.multiply(projMatrix, viewMatrix);

	// Set Geometry
	var data = createQuad(gl);

	// Create a vertexbuffer
	vertexBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, data.vertex, data.usage);

	// Unbind the buffer
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	// Lookup vertex data
	var a_Pos = gl.getAttribLocation(program, "vertexPos");
	var u_invViewMatrix = gl.getUniformLocation(program, "invView");
	var u_invProjMatrix = gl.getUniformLocation(program, "invProj");

  var u_Cam = gl.getUniformLocation(program, "u_CamPos");

	// Lookup fragment data
	var u_Light = gl.getUniformLocation(program, "light");
	var u_Metaballs = gl.getUniformLocation(program, "metaballs");
  var u_DiffuseColors = gl.getUniformLocation(program, "diffuseColors");
  var u_Res = gl.getUniformLocation(program, "res");

  // Lookup raydata
  var u_ray00 = gl.getUniformLocation(program, "ray00");
  var u_ray01 = gl.getUniformLocation(program, "ray01");
  var u_ray10 = gl.getUniformLocation(program, "ray10");
  var u_ray11 = gl.getUniformLocation(program, "ray11");

	//FPS
	var fpsEle = document.getElementById("fps");
	var fps = 0;
	var fpsCounter = 0;
	var fpsTimer = Date.now();

  var camX = document.getElementById("camX");
  var camY = document.getElementById("camY");
  var camZ = document.getElementById("camZ");

  // Setup all the needed attributes.
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.vertex, data.usage);
  gl.vertexAttribPointer(a_Pos, 2, gl.FLOAT, gl.FALSE, 0, 0);
  gl.enableVertexAttribArray(a_Pos);

  gl.useProgram(program);

  // update rays
  function updateRays(ray, ip, iv)
  {
    ray = m4.vectorMultiply(ray, ip);
    ray[0] /= ray[3];
    ray[1] /= ray[3];
    ray[2] /= ray[3];
    ray[3] /= ray[3];
    ray = m4.vectorMultiply(ray, iv);
    ray = subtractVectors(ray, eyeVec);
  }

  function KeyPress(step)
  {
      this.step = step || 1.5;
  }

  KeyPress.prototype.handler = function (event)
  {
      console.log(event.keyCode);

      switch (event.keyCode)
      {
          //Movement
          case 87:   //w
              eyeVec[2] += this.step;
              break;
          case 83:   //s
              eyeVec[2] -= this.step;
              break;
          case 65:   //a
              eyeVec[0] += this.step;
              break;
          case 68:   //d
              eyeVec[0] -= this.step;
              break;
          case 38:   //ArrowUp
              eyeVec[1] -= this.step;
              break;
          case 40:   //ArrowDown
              eyeVec[1] += this.step;
              break;
          default:
              return false;
      }

      return true;
  };

  //Key control
  var key = new KeyPress(0.5);
	function draw()
	{
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

			// ------ Draw the quad --------
			gl.drawArrays(data.mode, 0, data.n);
	}

	function update(time)
	{
    animationUpdate(time);

    // To send the metaballs data to the GPU, we first need to
    // flatten our data into a single array.
    for (var i = 0; i < nrOfMetaballs; i++)
    {
      var baseIndex = 4 * i;
      var mb = metaballs[i];
      metaData[baseIndex + 0] = mb.x;
      metaData[baseIndex + 1] = mb.y;
      metaData[baseIndex + 2] = mb.z;
      metaData[baseIndex + 3] = mb.r;
    }
    gl.uniform4fv(u_Metaballs, metaData);
    gl.uniform3fv(u_DiffuseColors, colorData);

    cameraMatrix = m4.lookAt(eyeVec, dirVec, upVec);
    viewMatrix = m4.inverse(cameraMatrix);

    projMatrix = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);
    invProjMatrix = m4.inverse(projMatrix);
    viewProjMatrix = m4.multiply(projMatrix, viewMatrix);

    gl.uniformMatrix4fv(u_invViewMatrix, false, viewMatrix);
    gl.uniformMatrix4fv(u_invProjMatrix, false, invProjMatrix);

    // Camera position
    camX.value = eyeVec[0];
    camY.value = eyeVec[1];
    camZ.value = eyeVec[2];
    gl.uniform3fv(u_Cam, new Float32Array([camX.value, camY.value, camZ.value]));

    gl.uniform2fv(u_Res, new Float32Array([gl.canvas.width, gl.canvas.height]));

    lightPosition = new Float32Array([camX.value, camY.value, -camZ.value]);

    var ray00 = new Float32Array([-1.0, -1.0, -1.0, 1.0]);
    var ray01 = new Float32Array([-1.0, 1.0, -1.0, 1.0]);
    var ray10 = new Float32Array([1.0, -1.0, -1.0, 1.0]);
    var ray11 = new Float32Array([1.0, 1.0, -1.0, 1.0]);

    updateRays(ray00, invProjMatrix, viewMatrix);
    updateRays(ray01, invProjMatrix, viewMatrix);
    updateRays(ray10, invProjMatrix, viewMatrix);
    updateRays(ray11, invProjMatrix, viewMatrix);

    gl.uniform4fv(u_ray00, ray00);
    gl.uniform4fv(u_ray01, ray01);
    gl.uniform4fv(u_ray10, ray10);
    gl.uniform4fv(u_ray11, ray11);

    // Light
    gl.uniform3fv(u_Light, lightPosition);

    draw();

    fpsEle.innerHTML = "FPS: " + fps;// + " (" + fpsCounter + ")";
	}

  // Data for the animation
  var speed = 0;
  var lowerWall = lowerSpawnArea - 20;
  var higherWall = higherSpawnArea + 20;

  function animationUpdate(time)
  {
      time *= speed * 5;

      metaballs.forEach(function(i)
      {
          if(i.x > higherWall)      // Left wall
          {
              i.randDirX = -metaballDir;
              i.randDirY = -metaballDir;
              i.randDirZ = -metaballDir;
          }
          if(i.x < lowerWall)    // Right wall
          {
              i.randDirX = metaballDir;
          }

          if(i.y > higherWall)     // Bottom wall
          {
            i.randDirX = -metaballDir;
            i.randDirY = -metaballDir;
            i.randDirZ = -metaballDir;
          }
          if(i.y < lowerWall)   // Top wall
          {
              i.randDirY = metaballDir;
          }

          if(i.z > higherWall)        // Farside wall
          {
            i.randDirX = -metaballDir;
            i.randDirY = -metaballDir;
            i.randDirZ = -metaballDir;
          }
          if(i.z < lowerWall)      // Near wall
          {
              i.randDirZ = metaballDir;
          }

          i.x += i.randDirX * time;
          i.y += i.randDirY * time;
          i.z += i.randDirZ * time;
      });
  }

	//A gameloop to animate
	var lastTick;
	var request;

	function gameLoop()
  {
			var now = Date.now();
			var time = (now - (lastTick || now)) / 1000;
			lastTick = now;

			//FPS
			fpsCounter++;
			if (now >= fpsTimer + 1000)
      {
					fps = fpsCounter;
					fpsCounter = 0;
					fpsTimer = now;
			}

			request = window.requestAnimFrame(gameLoop);

			update(time);
	}

	//Control panel
	var playElement = document.getElementById("play");
	playElement.addEventListener("click", function()
  {
			gameLoop();
	});

	var pauseElement = document.getElementById("pause");
	pauseElement.addEventListener("click", function()
  {
      window.cancelRequestAnimFrame(request);
	});

	var speedElement = document.getElementById("speed");
	speedElement.addEventListener("change", function()
  {
			speed = speedElement.value * 0.1;
  });
  
  var resetElement = document.getElementById("reset");
	resetElement.addEventListener("click", function()
  {
    for (var i = 0; i < nrOfMetaballs; i++)
    {   
      // Metaballs color data
      var baseIndex = 3 * i;
      colorData[0 + baseIndex] = getRandomInt(0, 100) / 100.0;
      colorData[1 + baseIndex] = getRandomInt(0, 100) / 100.0;
      colorData[2 + baseIndex] = getRandomInt(0, 100) / 100.0;
    }

    for (var i = 0; i < nrOfMetaballs; i++)
    {
      var baseIndex = 4 * i;
      var mb = metaballs[i];
      metaData[baseIndex + 0] = mb.x;
      metaData[baseIndex + 1] = mb.y;
      metaData[baseIndex + 2] = mb.z;
      metaData[baseIndex + 3] = mb.r;
    }
    gl.uniform4fv(u_Metaballs, metaData);
    gl.uniform3fv(u_DiffuseColors, colorData);
	});

  window.addEventListener("keydown", function (event)
  {
      if (key.handler(event))
      {
          draw();
      }
  });

	console.log("Everything is ready.");

	gameLoop();
};

window.onload = main;
