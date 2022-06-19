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
  return`
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
      vec2 res = vec2(1280, 720);
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

      color = lambertian * color + specular;

    	return color;
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
  `;
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

//------------------

function subtractVectors(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v) {
  var length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  // make sure we don't divide by 0.
  if (length > 0.00001) {
    return [v[0] / length, v[1] / length, v[2] / length];
  } else {
    return [0, 0, 0];
  }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}

// Creating our own matrix-system
var m4 = {

  lookAt: function(cameraPosition, target, up) {
    var zAxis = normalize(
        subtractVectors(cameraPosition, target));
    var xAxis = normalize(cross(up, zAxis));
    var yAxis = normalize(cross(zAxis, xAxis));

    return [
       xAxis[0], xAxis[1], xAxis[2], 0,
       yAxis[0], yAxis[1], yAxis[2], 0,
       zAxis[0], zAxis[1], zAxis[2], 0,
       cameraPosition[0],
       cameraPosition[1],
       cameraPosition[2],
       1,
    ];
  },

  perspective: function(fieldOfViewInRadians, aspect, near, far) {
    var f = Math.tan(Math.PI * 0.5 - 0.5 * fieldOfViewInRadians);
    var rangeInv = 1.0 / (near - far);

    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, -1,
      0, 0, near * far * rangeInv * 2, 0
    ];
  },

  projection: function(width, height, depth) {
    // Note: This matrix flips the Y axis so 0 is at the top.
    return [
       2 / width, 0, 0, 0,
       0, -2 / height, 0, 0,
       0, 0, 2 / depth, 0,
      -1, 1, 0, 1,
    ];
  },

  multiply: function(a, b) {
    var a00 = a[0 * 4 + 0];
    var a01 = a[0 * 4 + 1];
    var a02 = a[0 * 4 + 2];
    var a03 = a[0 * 4 + 3];
    var a10 = a[1 * 4 + 0];
    var a11 = a[1 * 4 + 1];
    var a12 = a[1 * 4 + 2];
    var a13 = a[1 * 4 + 3];
    var a20 = a[2 * 4 + 0];
    var a21 = a[2 * 4 + 1];
    var a22 = a[2 * 4 + 2];
    var a23 = a[2 * 4 + 3];
    var a30 = a[3 * 4 + 0];
    var a31 = a[3 * 4 + 1];
    var a32 = a[3 * 4 + 2];
    var a33 = a[3 * 4 + 3];
    var b00 = b[0 * 4 + 0];
    var b01 = b[0 * 4 + 1];
    var b02 = b[0 * 4 + 2];
    var b03 = b[0 * 4 + 3];
    var b10 = b[1 * 4 + 0];
    var b11 = b[1 * 4 + 1];
    var b12 = b[1 * 4 + 2];
    var b13 = b[1 * 4 + 3];
    var b20 = b[2 * 4 + 0];
    var b21 = b[2 * 4 + 1];
    var b22 = b[2 * 4 + 2];
    var b23 = b[2 * 4 + 3];
    var b30 = b[3 * 4 + 0];
    var b31 = b[3 * 4 + 1];
    var b32 = b[3 * 4 + 2];
    var b33 = b[3 * 4 + 3];
    return [
      b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30,
      b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31,
      b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32,
      b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33,
      b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30,
      b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31,
      b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32,
      b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33,
      b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30,
      b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31,
      b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32,
      b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33,
      b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30,
      b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31,
      b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32,
      b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33,
    ];
  },

  translation: function(tx, ty, tz) {
    return [
       1,  0,  0,  0,
       0,  1,  0,  0,
       0,  0,  1,  0,
       tx, ty, tz, 1,
    ];
  },

  xRotation: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);

    return [
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ];
  },

  yRotation: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);

    return [
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ];
  },

  zRotation: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);

    return [
       c, s, 0, 0,
      -s, c, 0, 0,
       0, 0, 1, 0,
       0, 0, 0, 1,
    ];
  },

  scaling: function(sx, sy, sz) {
    return [
      sx, 0,  0,  0,
      0, sy,  0,  0,
      0,  0, sz,  0,
      0,  0,  0,  1,
    ];
  },

  translate: function(m, tx, ty, tz) {
    return m4.multiply(m, m4.translation(tx, ty, tz));
  },

  xRotate: function(m, angleInRadians) {
    return m4.multiply(m, m4.xRotation(angleInRadians));
  },

  yRotate: function(m, angleInRadians) {
    return m4.multiply(m, m4.yRotation(angleInRadians));
  },

  zRotate: function(m, angleInRadians) {
    return m4.multiply(m, m4.zRotation(angleInRadians));
  },

  scale: function(m, sx, sy, sz) {
    return m4.multiply(m, m4.scaling(sx, sy, sz));
  },

  inverse: function(m) {
    var m00 = m[0 * 4 + 0];
    var m01 = m[0 * 4 + 1];
    var m02 = m[0 * 4 + 2];
    var m03 = m[0 * 4 + 3];
    var m10 = m[1 * 4 + 0];
    var m11 = m[1 * 4 + 1];
    var m12 = m[1 * 4 + 2];
    var m13 = m[1 * 4 + 3];
    var m20 = m[2 * 4 + 0];
    var m21 = m[2 * 4 + 1];
    var m22 = m[2 * 4 + 2];
    var m23 = m[2 * 4 + 3];
    var m30 = m[3 * 4 + 0];
    var m31 = m[3 * 4 + 1];
    var m32 = m[3 * 4 + 2];
    var m33 = m[3 * 4 + 3];
    var tmp_0  = m22 * m33;
    var tmp_1  = m32 * m23;
    var tmp_2  = m12 * m33;
    var tmp_3  = m32 * m13;
    var tmp_4  = m12 * m23;
    var tmp_5  = m22 * m13;
    var tmp_6  = m02 * m33;
    var tmp_7  = m32 * m03;
    var tmp_8  = m02 * m23;
    var tmp_9  = m22 * m03;
    var tmp_10 = m02 * m13;
    var tmp_11 = m12 * m03;
    var tmp_12 = m20 * m31;
    var tmp_13 = m30 * m21;
    var tmp_14 = m10 * m31;
    var tmp_15 = m30 * m11;
    var tmp_16 = m10 * m21;
    var tmp_17 = m20 * m11;
    var tmp_18 = m00 * m31;
    var tmp_19 = m30 * m01;
    var tmp_20 = m00 * m21;
    var tmp_21 = m20 * m01;
    var tmp_22 = m00 * m11;
    var tmp_23 = m10 * m01;

    var t0 = (tmp_0 * m11 + tmp_3 * m21 + tmp_4 * m31) -
        (tmp_1 * m11 + tmp_2 * m21 + tmp_5 * m31);
    var t1 = (tmp_1 * m01 + tmp_6 * m21 + tmp_9 * m31) -
        (tmp_0 * m01 + tmp_7 * m21 + tmp_8 * m31);
    var t2 = (tmp_2 * m01 + tmp_7 * m11 + tmp_10 * m31) -
        (tmp_3 * m01 + tmp_6 * m11 + tmp_11 * m31);
    var t3 = (tmp_5 * m01 + tmp_8 * m11 + tmp_11 * m21) -
        (tmp_4 * m01 + tmp_9 * m11 + tmp_10 * m21);

    var d = 1.0 / (m00 * t0 + m10 * t1 + m20 * t2 + m30 * t3);

    return [
      d * t0,
      d * t1,
      d * t2,
      d * t3,
      d * ((tmp_1 * m10 + tmp_2 * m20 + tmp_5 * m30) -
            (tmp_0 * m10 + tmp_3 * m20 + tmp_4 * m30)),
      d * ((tmp_0 * m00 + tmp_7 * m20 + tmp_8 * m30) -
            (tmp_1 * m00 + tmp_6 * m20 + tmp_9 * m30)),
      d * ((tmp_3 * m00 + tmp_6 * m10 + tmp_11 * m30) -
            (tmp_2 * m00 + tmp_7 * m10 + tmp_10 * m30)),
      d * ((tmp_4 * m00 + tmp_9 * m10 + tmp_10 * m20) -
            (tmp_5 * m00 + tmp_8 * m10 + tmp_11 * m20)),
      d * ((tmp_12 * m13 + tmp_15 * m23 + tmp_16 * m33) -
            (tmp_13 * m13 + tmp_14 * m23 + tmp_17 * m33)),
      d * ((tmp_13 * m03 + tmp_18 * m23 + tmp_21 * m33) -
            (tmp_12 * m03 + tmp_19 * m23 + tmp_20 * m33)),
      d * ((tmp_14 * m03 + tmp_19 * m13 + tmp_22 * m33) -
            (tmp_15 * m03 + tmp_18 * m13 + tmp_23 * m33)),
      d * ((tmp_17 * m03 + tmp_20 * m13 + tmp_23 * m23) -
            (tmp_16 * m03 + tmp_21 * m13 + tmp_22 * m23)),
      d * ((tmp_14 * m22 + tmp_17 * m32 + tmp_13 * m12) -
            (tmp_16 * m32 + tmp_12 * m12 + tmp_15 * m22)),
      d * ((tmp_20 * m32 + tmp_12 * m02 + tmp_19 * m22) -
            (tmp_18 * m22 + tmp_21 * m32 + tmp_13 * m02)),
      d * ((tmp_18 * m12 + tmp_23 * m32 + tmp_15 * m02) -
            (tmp_22 * m32 + tmp_14 * m02 + tmp_19 * m12)),
      d * ((tmp_22 * m22 + tmp_16 * m02 + tmp_21 * m12) -
            (tmp_20 * m12 + tmp_23 * m22 + tmp_17 * m02))
    ];
  },

  vectorMultiply: function(v, m) {
    var dst = [];
    for (var i = 0; i < 4; ++i) {
      dst[i] = 0.0;
      for (var j = 0; j < 4; ++j) {
        dst[i] += v[j] * m[j * 4 + i];
      }
    }
    return dst;
  },

};

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
